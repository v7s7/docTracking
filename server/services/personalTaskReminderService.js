// server/services/personalTaskReminderService.js
// Finds personal to-dos that are overdue (due_at in the past) or stale (no
// due date set, but still open after STALE_DAYS), and emails each owner a
// single digest covering everything of theirs that needs attention —
// deduped per task via personal_tasks.last_reminder_at so nothing is
// re-sent the same calendar day. Only dedupes on a successful send (mirrors
// chatReminderService.js): there's no in-app notification row for these
// (the dashboard's "My Tasks" card already shows overdue items highlighted
// whenever the owner looks), so email is the only delivery — if it fails,
// retry next run rather than silently skipping the task for the day.
const { db } = require('../db');
const { sendMail } = require('./mailService');

const STALE_DAYS = 3;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildEmailHtml(tasks, appUrl) {
  const rows = tasks.map(t => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(t.title)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${t.kind === 'overdue' ? '#C41E1E' : '#B7791F'};font-weight:600;">
        ${t.kind === 'overdue' ? 'متأخرة / Overdue' : 'بلا تقدم / No due date — still open'}
      </td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml((t.due_at || '').slice(0, 16))}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;">
      <div style="direction:rtl;text-align:right;">
        <p>لديك <b>${tasks.length}</b> من مهامك الشخصية تحتاج إنجازاً:</p>
      </div>
      <p style="color:#666;font-size:0.9em;">You have <b>${tasks.length}</b> personal task(s) needing attention:</p>
      <table style="border-collapse:collapse;width:100%;margin-top:10px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Task</th>
            <th style="padding:6px 10px;text-align:left;">Status</th>
            <th style="padding:6px 10px;text-align:left;">Due</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${appUrl ? `<p style="margin-top:14px;"><a href="${appUrl}" style="color:#C41E1E;">${escapeHtml(appUrl)}</a></p>` : ''}
    </div>
  `;
}

async function runPersonalTaskReminderCheck() {
  const now = new Date();
  const staleEdge = db.prepare(`SELECT datetime('now','localtime','-${STALE_DAYS} days') as v`).get().v;

  const candidates = db.prepare(`
    SELECT * FROM personal_tasks
    WHERE done = 0
      AND (last_reminder_at IS NULL OR date(last_reminder_at) != date('now','localtime'))
  `).all();

  const due = [];
  for (const task of candidates) {
    if (task.due_at) {
      const dueDate = new Date(task.due_at);
      if (!Number.isNaN(dueDate.getTime()) && dueDate < now) due.push({ ...task, kind: 'overdue' });
    } else if (task.created_at <= staleEdge) {
      due.push({ ...task, kind: 'stale' });
    }
  }

  if (!due.length) return { checked: candidates.length, notified: 0, emailed: 0 };

  const byUser = {};
  for (const task of due) {
    if (!byUser[task.user_id]) byUser[task.user_id] = [];
    byUser[task.user_id].push(task);
  }

  const markReminded = db.prepare("UPDATE personal_tasks SET last_reminder_at = datetime('now','localtime') WHERE id = ?");
  const appUrl = process.env.APP_URL || '';
  let emailed = 0;

  for (const [userId, tasks] of Object.entries(byUser)) {
    const user = db.prepare(
      "SELECT email FROM users WHERE id = ? AND is_active = 1 AND email IS NOT NULL AND email != ''"
    ).get(userId);
    if (!user) continue;

    const sent = await sendMail({
      to: user.email,
      subject: `[Doc Tracking] ${tasks.length} personal task(s) need attention`,
      html: buildEmailHtml(tasks, appUrl),
    });

    if (sent) {
      emailed += 1;
      for (const task of tasks) markReminded.run(task.id);
    }
  }

  return { checked: candidates.length, notified: due.length, emailed };
}

module.exports = { runPersonalTaskReminderCheck };
