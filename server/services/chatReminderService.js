// server/services/chatReminderService.js
// Finds chat messages sitting unread past a short quiet window and emails the
// person one digest covering all of them. "Unread" uses the same definition as
// the in-app badge (server/routes/messages.js): a message not sent by the user,
// newer than their last_read_at for that conversation.
//
// Deduping is per (person, conversation) in chat_email_log — NOT once per
// calendar day per person, which is what it used to be and why a second
// conversation in the afternoon sent nothing at all.
const { db } = require('../db');
const { sendMail } = require('./mailService');
const { isEmailEnabled } = require('./settingsService');
const { readConfig } = require('./configService');
const { layout, rowsTable, arabicPlural, CONVERSATIONS } = require('./emailTemplate');

// A short quiet window, not a long staleness timer. Five minutes is enough for
// a burst of messages to become ONE email, and enough for someone actually at
// their desk to see it in the app first.
const STALE_MINUTES = 5;

// Once a thread has been emailed, stay quiet about it until the person reads
// it — a second mail saying "you still have unread messages in the same
// conversation" carries no new information. The exception is a thread still
// unread hours later: one re-nudge, so nothing rots silently.
const RENUDGE_HOURS = 4;

// Someone with the app open has already had the badge and the live SSE
// notification; emailing them too is pure inbox noise. last_seen_at is
// refreshed every 60s by the client's presence ping, so a 3-minute window means
// "open right now" without being brittle about one missed ping.
const PRESENT_MINUTES = 3;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function deptLabel(id) {
  return readConfig().departments.find(d => d.id === id)?.label || id;
}

// Department threads have no explicit conversation_members row until the user
// first opens them, so DM/group (always an explicit row) and department
// (implicit access) need separate queries.
//
// The department predicate is NOT "every department conversation" any more.
// Without the peer/dept scoping below, this digest would email every employee a
// daily list of every private thread in the organisation.
function staleConversationsForUser(userId, cutoffIso) {
  const me = db.prepare('SELECT dept_id FROM users WHERE id = ?').get(userId) || {};
  const deptRows = db.prepare(`
    SELECT c.id, c.type, c.dept_id, c.peer_user_id, cm.last_read_at
    FROM conversations c
    LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE c.type = 'department'
      AND (c.peer_user_id = ? OR c.dept_id = ?)
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id != ?
          AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
          AND m.created_at <= ?
      )
  `).all(userId, userId, me.dept_id || '', userId, cutoffIso);

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
  if (conv.type === 'department') {
    // Several threads of the same department would otherwise repeat one
    // identical name down the digest with nothing to tell them apart.
    if (!conv.peer_user_id) return deptLabel(conv.dept_id);
    const peer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(conv.peer_user_id);
    return peer ? `${deptLabel(conv.dept_id)} — ${peer.full_name}` : deptLabel(conv.dept_id);
  }
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
  const total = items.reduce((n, i) => n + Number(i.unread || 0), 0);
  return layout({
    title: `لديك ${arabicPlural(items.length, CONVERSATIONS)} بها رسائل غير مقروءة`,
    lead:  `مجموع الرسائل غير المقروءة: ${total}.`,
    bodyHtml: rowsTable(items.map(i => ({ label: i.label, value: i.unread })),
                        ['المحادثة', 'غير مقروءة']),
    ctaUrl: appUrl,
    ctaLabel: 'فتح المحادثات',
    footer: `${items.length} conversation${items.length === 1 ? '' : 's'} with unread messages`,
  });
}

// Is this person using the app right now? Two signals: a live SSE connection
// (exact, but lost on a flaky network) and a recent presence ping (survives
// that). Either counts. When in doubt we treat them as away and send — a
// redundant email is a smaller failure than a missed message.
function isPresent(userId, freshIso) {
  try {
    if (require('../routes/messages').isUserOnline(userId)) return true;
  } catch (_) { /* routes not loaded (scripts, tests) — fall through */ }
  const row = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(userId);
  return !!(row && row.last_seen_at && row.last_seen_at >= freshIso);
}

/**
 * Which of this person's unread conversations may be emailed about right now.
 *
 * Suppressed when we have already written to them about that thread and they
 * have not read it since — unless RENUDGE_HOURS have passed and it is STILL
 * unread, which earns exactly one more mail.
 */
function emailableConversations(userId, stale, renudgeIso) {
  const logRow = db.prepare(
    'SELECT last_emailed_at FROM chat_email_log WHERE user_id = ? AND conversation_id = ?'
  );
  return stale.filter(conv => {
    const log = logRow.get(userId, conv.id);
    if (!log) return true;                                              // never emailed about this one
    if (conv.last_read_at && conv.last_read_at > log.last_emailed_at) return true;  // fresh unread streak
    return log.last_emailed_at <= renudgeIso;                           // long-overdue re-nudge
  });
}

async function runChatReminderCheck() {
  // The master switch being off is a deliberate setting, not a transient SMTP
  // failure, and the two must not be treated alike. sendMail() suppresses each
  // digest and returns false; because nothing is then recorded as sent, the very
  // same digests are rebuilt and suppressed again sixty seconds later, forever.
  // Skip the pass outright instead.
  if (!isEmailEnabled()) {
    return { checked: 0, present: 0, notified: 0, emailed: 0, skipped: 'email switch is off' };
  }

  const t = db.prepare(`SELECT
      datetime('now','localtime') AS now,
      datetime('now','localtime','-${STALE_MINUTES} minutes') AS stale,
      datetime('now','localtime','-${PRESENT_MINUTES} minutes') AS fresh,
      datetime('now','localtime','-${RENUDGE_HOURS} hours') AS renudge`).get();

  // Every active mailbox is a candidate on every run. The previous query
  // excluded anyone already emailed today, which is why a second conversation
  // later the same day sent nothing at all.
  const users = db.prepare(`
    SELECT id, email FROM users
    WHERE is_active = 1 AND email IS NOT NULL AND email != ''
  `).all();

  const appUrl = process.env.APP_URL || '';
  const remember = db.prepare(`
    INSERT INTO chat_email_log (user_id, conversation_id, last_emailed_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET last_emailed_at = excluded.last_emailed_at
  `);

  let present = 0, notified = 0, emailed = 0;

  for (const user of users) {
    const stale = staleConversationsForUser(user.id, t.stale);
    if (!stale.length) continue;

    // Presence is checked only for people who actually have something waiting,
    // so a quiet directory costs one query rather than 119.
    if (isPresent(user.id, t.fresh)) { present += 1; continue; }

    const due = emailableConversations(user.id, stale, t.renudge);
    if (!due.length) continue;
    notified += 1;

    // One mail listing every due thread — never one mail per thread.
    const items = due.map(c => ({ label: conversationLabel(c, user.id), unread: c.unread }));
    const sent = await sendMail({
      to: user.email,
      subject: `رسائل غير مقروءة — ${arabicPlural(due.length, CONVERSATIONS)}`,
      html: buildEmailHtml(items, appUrl),
    });

    // Recorded only on a successful send: if SMTP is down we retry next minute
    // rather than marking the thread handled and going quiet about it.
    if (sent) {
      emailed += 1;
      db.transaction(() => { for (const c of due) remember.run(user.id, c.id, t.now); })();
    }
  }

  return { checked: users.length, present, notified, emailed };
}

module.exports = { runChatReminderCheck };
