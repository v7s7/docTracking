// server/services/chatReminderService.js
// Finds users who have chat messages sitting unread for too long and emails
// them a nudge (deduped to once per calendar day via
// users.last_chat_reminder_at). "Unread" uses the same definition as the
// in-app badge (server/routes/messages.js): a message not sent by the user,
// newer than their last_read_at for that conversation.
const { db } = require('../db');
const { sendMail } = require('./mailService');
const { readConfig } = require('./configService');

const STALE_HOURS = 1;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function deptLabel(id) {
  return readConfig().departments.find(d => d.id === id)?.label || id;
}

// Department channels have no explicit conversation_members row until the
// user first opens them, so DM/group (always an explicit row) and
// department (implicit access for everyone) need separate queries.
function staleConversationsForUser(userId, cutoffIso) {
  const deptRows = db.prepare(`
    SELECT c.id, c.type, c.dept_id, cm.last_read_at
    FROM conversations c
    LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE c.type = 'department'
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id != ?
          AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
          AND m.created_at <= ?
      )
  `).all(userId, userId, cutoffIso);

  const dmRows = db.prepare(`
    SELECT c.id, c.type, c.dept_id, cm.last_read_at
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = ? AND c.type IN ('dm','group')
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id != ?
          AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
          AND m.created_at <= ?
      )
  `).all(userId, userId, cutoffIso);

  return [...deptRows, ...dmRows].map(conv => {
    const unread = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE conversation_id = ? AND sender_id != ?
        AND (? IS NULL OR created_at > ?)
    `).get(conv.id, userId, conv.last_read_at, conv.last_read_at).n;
    return { ...conv, unread };
  });
}

function conversationLabel(conv, userId) {
  if (conv.type === 'department') return deptLabel(conv.dept_id);
  if (conv.type === 'group') {
    const others = db.prepare(`
      SELECT u.full_name FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.user_id != ? ORDER BY u.full_name COLLATE NOCASE
    `).all(conv.id, userId).map(r => r.full_name);
    return others.join(', ') || 'Group chat';
  }
  const other = db.prepare(`
    SELECT u.full_name FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ? AND cm.user_id != ?
  `).get(conv.id, userId);
  return other?.full_name || '—';
}

function buildEmailHtml(items, appUrl) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(i.label)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.unread}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;">
      <div style="direction:rtl;text-align:right;">
        <p>لديك رسائل غير مقروءة في <b>${items.length}</b> محادثة:</p>
      </div>
      <p style="color:#666;font-size:0.9em;">You have unread messages waiting in <b>${items.length}</b> conversation(s):</p>
      <table style="border-collapse:collapse;width:100%;margin-top:10px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Conversation</th>
            <th style="padding:6px 10px;text-align:left;">Unread</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${appUrl ? `<p style="margin-top:14px;"><a href="${appUrl}" style="color:#C41E1E;">${escapeHtml(appUrl)}</a></p>` : ''}
    </div>
  `;
}

async function runChatReminderCheck() {
  const cutoffIso = db.prepare(`SELECT datetime('now','localtime','-${STALE_HOURS} hours') as v`).get().v;

  const users = db.prepare(`
    SELECT id, email FROM users
    WHERE is_active = 1 AND email IS NOT NULL AND email != ''
      AND (last_chat_reminder_at IS NULL OR date(last_chat_reminder_at) != date('now','localtime'))
  `).all();

  const appUrl = process.env.APP_URL || '';
  const markReminded = db.prepare("UPDATE users SET last_chat_reminder_at = datetime('now','localtime') WHERE id = ?");

  let notified = 0;
  let emailed  = 0;

  for (const user of users) {
    const stale = staleConversationsForUser(user.id, cutoffIso);
    if (!stale.length) continue;
    notified += 1;

    const items = stale.map(c => ({ label: conversationLabel(c, user.id), unread: c.unread }));
    const sent = await sendMail({
      to: user.email,
      subject: `[Doc Tracking] You have unread messages in ${stale.length} conversation(s)`,
      html: buildEmailHtml(items, appUrl),
    });

    // Only dedupe on a successful send — if SMTP is down, retry on the next
    // run instead of silently skipping the user for the rest of the day.
    if (sent) { emailed += 1; markReminded.run(user.id); }
  }

  return { checked: users.length, notified, emailed };
}

module.exports = { runChatReminderCheck };
