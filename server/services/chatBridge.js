// server/services/chatBridge.js
// The one place correspondence is allowed to touch chat.
//
// Everything here delegates to the helpers exported by routes/messages.js
// rather than re-implementing them — channel creation and membership rules
// live in exactly one file, so the two subsystems cannot drift apart on who
// belongs to what.
//
// `require` is deliberately lazy (inside the functions, not at module load):
// messages.js and this file are both pulled in during server start-up, and a
// top-level require here would depend on their load order.
const { db } = require('../db');

function chat() {
  return require('../routes/messages');
}

// A message attributed to the system rather than a person. sender_id 0 is
// never a real user id, so the client renders it as a system line.
const SYSTEM_ID   = 0;
const SYSTEM_NAME = 'نظام المراسلات';

function postSystem(conversationId, text) {
  if (!conversationId || !text) return null;
  try {
    const info = db.prepare(`
      INSERT INTO messages (conversation_id, sender_id, sender_name, content)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, SYSTEM_ID, SYSTEM_NAME, text);
    return info.lastInsertRowid;
  } catch (e) {
    console.warn('[ChatBridge] could not post system message:', e.message);
    return null;
  }
}

/** Announce something in a department's channel. Best-effort. */
function postToDepartment(deptId, text) {
  if (!deptId) return null;
  try {
    const conv = chat().ensureDeptConversation(deptId);
    const id = postSystem(conv.id, text);
    if (id) {
      // Wake anyone with the app open, same as a human message would.
      const members = db.prepare(
        'SELECT user_id FROM conversation_members WHERE conversation_id = ?'
      ).all(conv.id).map(r => r.user_id);
      try { chat().broadcastToUsers(members, 'message', { conversation_id: conv.id }); } catch { /* SSE optional */ }
    }
    return conv.id;
  } catch (e) {
    console.warn('[ChatBridge] department post failed:', e.message);
    return null;
  }
}

/**
 * Find or create the direct conversation between two users, and optionally
 * open it with a line of context. Returns the conversation id.
 */
function openDm(userAId, userBId, openingLine) {
  if (!userAId || !userBId || userAId === userBId) return null;
  try {
    let conv = db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
      JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
      WHERE c.type = 'dm'
    `).get(userAId, userBId);

    if (!conv) {
      const info = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run();
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
      chat().ensureMembership(conv.id, userAId);
      chat().ensureMembership(conv.id, userBId);
      if (openingLine) postSystem(conv.id, openingLine);
    }
    try { chat().broadcastToUsers([userAId, userBId], 'message', { conversation_id: conv.id }); } catch { /* optional */ }
    return conv.id;
  } catch (e) {
    console.warn('[ChatBridge] DM open failed:', e.message);
    return null;
  }
}

/** Live presence for one user, or null when they have no account yet. */
function presenceOf(userId) {
  if (!userId) return null;
  const u = db.prepare(
    'SELECT id, full_name, last_seen_at, presence_status, status_text, ext, mobile FROM users WHERE id = ? AND is_active = 1'
  ).get(userId);
  if (!u) return null;
  let online = false;
  try { online = chat().isUserOnline(u.id); } catch { /* SSE not up */ }
  return { ...u, online };
}

function presenceByUsername(username) {
  if (!username) return null;
  const u = db.prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(username);
  return u ? presenceOf(u.id) : null;
}

module.exports = { postToDepartment, openDm, postSystem, presenceOf, presenceByUsername, SYSTEM_ID };
