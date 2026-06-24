// server/services/reminderService.js
// Finds tasks that are overdue or due soon, raises one in-app notification
// per task (deduped to once per calendar day via tasks.last_reminder_at),
// and emails each affected department's staff a digest of what needs
// attention. Designed to be called from the daily scheduler, at startup,
// or manually via POST /admin/reminders/run.
const { db } = require('../db');
const { sendMail } = require('./mailService');
const { readConfig } = require('./configService');

const DUE_SOON_HOURS = 48;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function deptLabel(depts, id) {
  return depts.find(d => d.id === id)?.label || id;
}

function buildEmailHtml(label, tasks, appUrl) {
  const rows = tasks.map(t => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(t.serial)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(t.title)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${t.kind === 'overdue' ? '#C41E1E' : '#B7791F'};font-weight:600;">
        ${t.kind === 'overdue' ? 'متأخرة / Overdue' : 'قريبة الاستحقاق / Due soon'}
      </td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml((t.expected_at || '').slice(0, 16))}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;">
      <div style="direction:rtl;text-align:right;">
        <p>لديك <b>${tasks.length}</b> مهمة تحتاج اهتمام في قسم <b>${escapeHtml(label)}</b>:</p>
      </div>
      <p style="color:#666;font-size:0.9em;">You have <b>${tasks.length}</b> task(s) needing attention in <b>${escapeHtml(label)}</b>:</p>
      <table style="border-collapse:collapse;width:100%;margin-top:10px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Serial</th>
            <th style="padding:6px 10px;text-align:left;">Title</th>
            <th style="padding:6px 10px;text-align:left;">Status</th>
            <th style="padding:6px 10px;text-align:left;">Expected</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${appUrl ? `<p style="margin-top:14px;"><a href="${appUrl}" style="color:#C41E1E;">${escapeHtml(appUrl)}</a></p>` : ''}
    </div>
  `;
}

async function runReminderCheck() {
  const now      = new Date();
  const soonEdge = new Date(now.getTime() + DUE_SOON_HOURS * 3600 * 1000);

  const candidates = db.prepare(`
    SELECT * FROM tasks
    WHERE status NOT IN ('closed', 'returned')
      AND current_dept_id IS NOT NULL AND current_dept_id != ''
      AND expected_at IS NOT NULL AND expected_at != ''
      AND (last_reminder_at IS NULL OR date(last_reminder_at) != date('now','localtime'))
  `).all();

  const due = [];
  for (const task of candidates) {
    const expected = new Date(task.expected_at);
    if (Number.isNaN(expected.getTime())) continue;
    if (expected < now) {
      due.push({ ...task, kind: 'overdue' });
    } else if (expected <= soonEdge) {
      due.push({ ...task, kind: 'due_soon' });
    }
  }

  if (!due.length) return { checked: candidates.length, notified: 0, emailed: 0 };

  const byDept = {};
  for (const task of due) {
    if (!byDept[task.current_dept_id]) byDept[task.current_dept_id] = [];
    byDept[task.current_dept_id].push(task);
  }

  const markReminded = db.prepare("UPDATE tasks SET last_reminder_at = datetime('now','localtime') WHERE id = ?");
  const insertNotif  = db.prepare(`
    INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const task of due) {
    insertNotif.run(task.current_dept_id, task.id, task.serial, task.title, task.kind);
    markReminded.run(task.id);
  }

  const depts  = readConfig().departments || [];
  const appUrl = process.env.APP_URL || '';
  let emailed  = 0;

  for (const [deptId, tasks] of Object.entries(byDept)) {
    const recipients = db.prepare(
      "SELECT email FROM users WHERE dept_id = ? AND is_active = 1 AND email IS NOT NULL AND email != ''"
    ).all(deptId).map(r => r.email);

    if (!recipients.length) continue;

    const label = deptLabel(depts, deptId);
    const sent = await sendMail({
      to: recipients,
      subject: `[Doc Tracking] ${tasks.length} task(s) need attention — ${label}`,
      html: buildEmailHtml(label, tasks, appUrl),
    });
    if (sent) emailed += recipients.length;
  }

  return { checked: candidates.length, notified: due.length, emailed };
}

module.exports = { runReminderCheck };
