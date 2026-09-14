// server/services/reminderService.js
// Finds tasks that are overdue or due soon, raises one in-app notification
// per task (deduped to once per calendar day via tasks.last_reminder_at),
// and emails each affected department's staff a digest of what needs
// attention. Designed to be called from the daily scheduler, at startup,
// or manually via POST /admin/reminders/run.
const { db } = require('../db');
const { sendMail } = require('./mailService');
const { readConfig } = require('./configService');
const { layout, ltr, esc, arabicPlural, TASKS, BRAND } = require('./emailTemplate');

const DUE_SOON_HOURS = 48;

function deptLabel(depts, id) {
  return depts.find(d => d.id === id)?.label || id;
}

// Overdue in the brand's own warning red; due-soon in amber. Local to this one
// table rather than added to BRAND, which is the shared chrome's palette, not
// every status colour any one email might need.
const STATUS_COLOR = { overdue: '#C41E1E', due_soon: '#B7791F' };
const STATUS_LABEL = { overdue: 'متأخرة', due_soon: 'قريبة الاستحقاق' };

/**
 * The task table. Not built with emailTemplate's rowsTable() — that helper is
 * a fixed label/value pair, and a task needs four columns — but it borrows the
 * exact same colours and font stack (BRAND, imported) so it sits inside
 * layout()'s shell without looking like a different product bolted on, which
 * is exactly what this whole file looked like before: Arial instead of Tahoma,
 * an English-only header row, and a bilingual status tag doing "Overdue" work
 * twice in one line. serial and the date are Latin content inside an Arabic
 * table — ltr() isolates them for the same bidi reason the correspondence
 * emails already had to fix once.
 */
function taskRows(tasks) {
  return tasks.map(t => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-family:Tahoma,Arial,sans-serif;font-size:13px;color:${BRAND.ink};">${ltr(t.serial)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-family:Tahoma,Arial,sans-serif;font-size:13px;color:${BRAND.ink};">${esc(t.title)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-family:Tahoma,Arial,sans-serif;font-size:13px;font-weight:bold;color:${STATUS_COLOR[t.kind] || BRAND.ink};white-space:nowrap;">${STATUS_LABEL[t.kind] || ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-family:Tahoma,Arial,sans-serif;font-size:13px;color:${BRAND.muted};">${ltr((t.expected_at || '').slice(0, 16))}</td>
    </tr>`).join('');
}

function buildEmailHtml(label, tasks, appUrl) {
  const head = ['الرقم', 'العنوان', 'الحالة', 'الموعد المتوقع'];
  const table = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl"
           style="border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
      <tr style="background:${BRAND.wash};">
        ${head.map(h => `<th align="right" style="padding:8px 10px;font-family:Tahoma,Arial,sans-serif;font-size:12px;color:${BRAND.muted};font-weight:normal;">${esc(h)}</th>`).join('')}
      </tr>
      ${taskRows(tasks)}
    </table>`;

  return layout({
    title: `لديك ${arabicPlural(tasks.length, TASKS)} تحتاج اهتمامك`,
    lead:  `في قسم ${label}.`,
    bodyHtml: table,
    ctaUrl: appUrl,
    ctaLabel: 'فتح المهام',
    footer: `${tasks.length} task(s) need attention — ${label}`,
  });
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
      // Natural Arabic, matching how the other three notification types write
      // theirs — "[Doc Tracking] N task(s)..." was the one subject line in the
      // system that was entirely English, bracket-prefixed, and looked like it
      // came from a different product than the rest of the mail this system
      // sends.
      subject: `${arabicPlural(tasks.length, TASKS)} تحتاج اهتمامك — ${label}`,
      html: buildEmailHtml(label, tasks, appUrl),
    });
    if (sent) emailed += recipients.length;
  }

  return { checked: candidates.length, notified: due.length, emailed };
}

module.exports = { runReminderCheck };
