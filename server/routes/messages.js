const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const { db }  = require('../db');
const { verifyToken, ROLE_WEIGHT } = require('../middleware/authMiddleware');
const { readConfig }  = require('../services/configService');

// Managers and above can pin/unpin announcements in a conversation.
function isManager(role) {
  return (ROLE_WEIGHT[role] || 0) >= ROLE_WEIGHT.MANAGER;
}

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads', 'messages');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Executable types are blocked; everything else (docs, images, archives) is allowed.
const BLOCKED_EXT = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.scr', '.ps1'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // Random filename — originalname (kept separately in the DB) is never used on disk.
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  // 15MB per attachment; fieldSize covers the "content" text field itself —
  // default is 1MB, too small for a very large pasted block of text.
  limits: { fileSize: 15 * 1024 * 1024, fieldSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.includes(ext)) return cb(new Error('This file type is not allowed.'));
    cb(null, true);
  },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

router.use(verifyToken);

// Accounts not yet assigned a local user record (fresh LDAP logins) can't
// own conversations/messages until a Super Admin assigns them.
router.use((req, res, next) => {
  if (!req.user.id) {
    return res.status(403).json({ success: false, message: 'Your account is not fully set up yet. Contact an administrator.' });
  }
  next();
});

function deptLabel(deptId) {
  const dept = readConfig().departments.find(d => d.id === deptId);
  return dept ? dept.label : deptId;
}

function ensureDeptConversation(deptId) {
  let conv = db.prepare("SELECT * FROM conversations WHERE type='department' AND dept_id=?").get(deptId);
  if (!conv) {
    const info = db.prepare("INSERT INTO conversations (type, dept_id) VALUES ('department', ?)").run(deptId);
    conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
  }
  return conv;
}

// Every department has a group conversation, visible to all staff (Teams-style channels).
function ensureAllDeptConversations() {
  readConfig().departments.forEach(d => ensureDeptConversation(d.id));
}

function ensureMembership(conversationId, userId) {
  const row = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId, userId);
  if (!row) {
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)").run(conversationId, userId);
  }
}

function touchRead(conversationId, userId) {
  ensureMembership(conversationId, userId);
  const now = db.prepare("SELECT datetime('now','localtime') as now").get().now;
  db.prepare("UPDATE conversation_members SET last_read_at = ? WHERE conversation_id=? AND user_id=?")
    .run(now, conversationId, userId);
  db.prepare("UPDATE message_mentions SET is_read=1 WHERE conversation_id=? AND user_id=?")
    .run(conversationId, userId);
  return now;
}

// Notify other members that this user has read up to `lastReadAt` (DM/group only —
// department channels can have too many members for per-message read receipts to be useful).
function broadcastReadReceipt(conv, userId, lastReadAt) {
  if (conv.type === 'department') return;
  const memberIds = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id != ?")
    .all(conv.id, userId).map(r => r.user_id);
  broadcastToUsers(memberIds, 'read', { conversation_id: conv.id, user_id: userId, last_read_at: lastReadAt });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Scan message content for "@Full Name" occurrences matching real users who can
// see this conversation, so we can highlight + notify them.
function detectMentions(content, conv, senderId) {
  if (!content) return [];

  let candidates;
  if (conv.type === 'department') {
    candidates = db.prepare("SELECT id, full_name FROM users WHERE is_active=1").all();
  } else if (conv.type === 'group') {
    candidates = db.prepare(`
      SELECT u.id, u.full_name FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
    `).all(conv.id);
  } else {
    return [];
  }

  return candidates.filter(c => {
    if (c.id === senderId) return false;
    const re = new RegExp(`@${escapeRegExp(c.full_name)}(?![A-Za-z0-9])`, 'i');
    return re.test(content);
  });
}

// Aggregate emoji reactions for a message: [{ emoji, count, userIds }]
function getReactions(messageId) {
  const rows = db.prepare("SELECT emoji, user_id FROM message_reactions WHERE message_id=?").all(messageId);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.user_id);
  }
  return [...map.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}

// Small preview of the message being replied to, for rendering a quote block
function getReplyPreview(messageId) {
  return db.prepare("SELECT id, sender_name, content, file_name FROM messages WHERE id=?").get(messageId) || null;
}

// The pinned announcement for a conversation (at most one at a time), if any
function getPinnedMessage(conversationId) {
  return db.prepare(`
    SELECT id, sender_name, content, file_name, pinned_at, pinned_by
    FROM messages WHERE conversation_id=? AND pinned_at IS NOT NULL
    ORDER BY pinned_at DESC LIMIT 1
  `).get(conversationId) || null;
}

function attachExtras(message) {
  return {
    ...message,
    mentions: message.mentions ? JSON.parse(message.mentions) : [],
    reactions: getReactions(message.id),
    reply_to: message.reply_to_id ? getReplyPreview(message.reply_to_id) : null,
  };
}

// Live updates (SSE) — userId -> Set of open response streams
const sseClients = new Map();

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastToUsers(userIds, event, data) {
  for (const userId of userIds) {
    const clients = sseClients.get(userId);
    if (!clients) continue;
    for (const res of clients) sseSend(res, event, data);
  }
}

// A user with an open SSE stream has the app open right now — the most
// reliable "online" signal, independent of the presence heartbeat.
function isUserOnline(userId) {
  const clients = sseClients.get(userId);
  return !!clients && clients.size > 0;
}

// All members of a conversation (used for ad-hoc group chats), with live presence
function groupMembers(convId) {
  return db.prepare(`
    SELECT u.id, u.full_name, u.role, u.dept_id, u.last_seen_at, u.presence_status, u.status_text, u.avatar_url, u.avatar_color
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ? ORDER BY u.full_name COLLATE NOCASE
  `).all(convId).map(u => ({ ...u, online: isUserOnline(u.id) }));
}

// Returns the conversation row if the user may access it, else null
function getAccessibleConversation(conversationId, user) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(conversationId);
  if (!conv) return null;
  // Department groups are open channels — every user can view and post.
  if (conv.type === 'department') return conv;
  const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId, user.id);
  return member ? conv : null;
}

// GET /messages/directory — colleagues available to start a DM with
router.get('/directory', (req, res) => {
  const users = db.prepare(
    "SELECT id, full_name, role, dept_id, last_seen_at, presence_status, status_text, avatar_url, avatar_color FROM users WHERE is_active=1 AND id != ? ORDER BY full_name COLLATE NOCASE"
  ).all(req.user.id).map(u => ({ ...u, online: isUserOnline(u.id) }));
  res.json({ success: true, users });
});

// GET /messages/stream — live updates (SSE): pushes new messages as they arrive
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const userId = req.user.id;
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  const heartbeat = setInterval(() => res.write(':\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.get(userId)?.delete(res);
  });
});

// GET /messages/conversations — list my conversations (all department groups + my DMs)
router.get('/conversations', (req, res) => {
  ensureAllDeptConversations();

  const deptRows = db.prepare(`
    SELECT c.*, cm.last_read_at, cm.hidden_at
    FROM conversations c
    LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE c.type = 'department'
  `).all(req.user.id);

  const dmRows = db.prepare(`
    SELECT c.*, cm.last_read_at, cm.hidden_at
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = ? AND c.type IN ('dm','group')
  `).all(req.user.id);

  const rows = [...deptRows, ...dmRows];

  const result = rows.map(conv => {
    const unread = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE conversation_id = ? AND sender_id != ?
        AND (? IS NULL OR created_at > ?)
    `).get(conv.id, req.user.id, conv.last_read_at, conv.last_read_at).n;

    const last = db.prepare(
      "SELECT sender_id, content, file_name, sender_name, created_at FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1"
    ).get(conv.id);

    let display;
    if (conv.type === 'department') {
      display = { name: deptLabel(conv.dept_id), dept_id: conv.dept_id };
    } else if (conv.type === 'group') {
      const others = groupMembers(conv.id).filter(m => m.id !== req.user.id);
      display = { name: others.map(o => o.full_name).join(', ') };
    } else {
      const other = db.prepare(`
        SELECT u.id, u.full_name, u.role, u.dept_id, u.last_seen_at, u.presence_status, u.status_text, u.avatar_url, u.avatar_color
        FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.user_id != ?
      `).get(conv.id, req.user.id);
      if (other) other.online = isUserOnline(other.id);
      display = { name: other?.full_name || '—', other_user: other };
    }

    const mentioned = !!db.prepare(
      "SELECT 1 FROM message_mentions WHERE conversation_id=? AND user_id=? AND is_read=0 LIMIT 1"
    ).get(conv.id, req.user.id);

    return {
      id: conv.id,
      type: conv.type,
      ...display,
      unread,
      last_message: last || null,
      hidden: !!conv.hidden_at,
      mentioned,
    };
  });

  result.sort((a, b) => {
    const at = a.last_message?.created_at || '';
    const bt = b.last_message?.created_at || '';
    return bt.localeCompare(at);
  });

  res.json({ success: true, conversations: result });
});

// POST /messages/dm/:userId — get or create a DM conversation
router.post('/dm/:userId', (req, res) => {
  const otherId = Number(req.params.userId);
  if (otherId === req.user.id) {
    return res.status(400).json({ success: false, message: 'Cannot message yourself.' });
  }
  const other = db.prepare("SELECT id, full_name, role, dept_id, last_seen_at, presence_status, status_text, avatar_url, avatar_color FROM users WHERE id=? AND is_active=1").get(otherId);
  if (!other) return res.status(404).json({ success: false, message: 'User not found.' });
  other.online = isUserOnline(other.id);

  let conv = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    WHERE c.type = 'dm'
  `).get(req.user.id, otherId);

  if (!conv) {
    const info = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run();
    conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
    ensureMembership(conv.id, req.user.id);
    ensureMembership(conv.id, otherId);
  }

  res.json({ success: true, conversation: { id: conv.id, type: 'dm', name: other.full_name, other_user: other, unread: 0, last_message: null } });
});

// POST /messages/group — get or create a chat with the given members (DM if just one, group otherwise)
router.post('/group', (req, res) => {
  const ids = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(Number) : [];
  const otherIds = [...new Set(ids.filter(id => Number.isInteger(id) && id !== req.user.id))];

  if (!otherIds.length) {
    return res.status(400).json({ success: false, message: 'Select at least one person.' });
  }

  const placeholders = otherIds.map(() => '?').join(',');
  const users = db.prepare(
    `SELECT id, full_name, role, dept_id, last_seen_at, presence_status, status_text, avatar_url, avatar_color FROM users WHERE is_active=1 AND id IN (${placeholders})`
  ).all(...otherIds);
  if (users.length !== otherIds.length) {
    return res.status(404).json({ success: false, message: 'One or more users not found.' });
  }

  // Exactly one other person — reuse/create the 1:1 DM conversation.
  if (otherIds.length === 1) {
    const otherId = otherIds[0];
    let conv = db.prepare(`
      SELECT c.* FROM conversations c
      JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
      JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
      WHERE c.type = 'dm'
    `).get(req.user.id, otherId);

    if (!conv) {
      const info = db.prepare("INSERT INTO conversations (type) VALUES ('dm')").run();
      conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
      ensureMembership(conv.id, req.user.id);
      ensureMembership(conv.id, otherId);
    }

    const other = users[0];
    other.online = isUserOnline(other.id);
    return res.json({ success: true, conversation: { id: conv.id, type: 'dm', name: other.full_name, other_user: other, unread: 0, last_message: null } });
  }

  // Multiple people — find an existing group with exactly this member set, or create one.
  const allIds = [req.user.id, ...otherIds];
  const candidates = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.type = 'group'
    GROUP BY c.id
    HAVING COUNT(*) = ?
  `).all(allIds.length);

  let conv = null;
  for (const c of candidates) {
    const members = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(c.id).map(r => r.user_id);
    if (allIds.every(id => members.includes(id))) {
      conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(c.id);
      break;
    }
  }

  if (!conv) {
    const info = db.prepare("INSERT INTO conversations (type) VALUES ('group')").run();
    conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
    allIds.forEach(id => ensureMembership(conv.id, id));
  }

  const others = groupMembers(conv.id).filter(m => m.id !== req.user.id);
  res.json({ success: true, conversation: { id: conv.id, type: 'group', name: others.map(o => o.full_name).join(', '), unread: 0, last_message: null } });
});

// GET /messages/conversations/:id/messages — fetch (optionally only messages after a given id, for polling)
router.get('/conversations/:id/messages', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const after = req.query.after ? Number(req.query.after) : 0;
  const messages = db.prepare(
    "SELECT * FROM messages WHERE conversation_id=? AND id > ? ORDER BY id ASC"
  ).all(conv.id, after).map(attachExtras);

  res.json({ success: true, messages });
});

// POST /messages/conversations/:id/messages — send text and/or an attachment
router.post('/conversations/:id/messages', uploadSingle, (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const content = (req.body.content || '').trim();
  const file = req.file;
  if (!content && !file) {
    return res.status(400).json({ success: false, message: 'Message cannot be empty.' });
  }

  const mentions = detectMentions(content, conv, req.user.id);

  let replyToId = null;
  if (req.body.replyToId) {
    const replyTo = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=?")
      .get(Number(req.body.replyToId), conv.id);
    if (replyTo) replyToId = replyTo.id;
  }

  const info = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, sender_name, content, file_url, file_name, file_type, file_size, mentions, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conv.id, req.user.id, req.user.name || req.user.username, content || null,
    file ? `/uploads/messages/${file.filename}` : null,
    file ? file.originalname : null,
    file ? file.mimetype : null,
    file ? file.size : null,
    mentions.length ? JSON.stringify(mentions) : null,
    replyToId,
  );

  const lastReadAt = touchRead(conv.id, req.user.id);

  const message = attachExtras(db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid));
  res.status(201).json({ success: true, message });

  const recipientIds = conv.type === 'department'
    ? db.prepare("SELECT id FROM users WHERE is_active=1").all().map(r => r.id)
    : db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conv.id).map(r => r.user_id);
  broadcastToUsers(recipientIds, 'message', { conversation_id: conv.id, message });
  broadcastReadReceipt(conv, req.user.id, lastReadAt);

  if (mentions.length) {
    for (const mu of mentions) {
      db.prepare("INSERT INTO message_mentions (message_id, conversation_id, user_id) VALUES (?, ?, ?)")
        .run(info.lastInsertRowid, conv.id, mu.id);
    }
    broadcastToUsers(mentions.map(m => m.id), 'mention', { conversation_id: conv.id, message });
  }
});

// GET /messages/conversations/:id/members — roster with live presence (department staff or group members)
router.get('/conversations/:id/members', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  let members;
  if (conv.type === 'department') {
    members = db.prepare(
      "SELECT id, full_name, role, dept_id, last_seen_at, presence_status, status_text, avatar_url, avatar_color FROM users WHERE is_active=1 AND dept_id=? ORDER BY full_name COLLATE NOCASE"
    ).all(conv.dept_id).map(m => ({ ...m, online: isUserOnline(m.id) }));
  } else if (conv.type === 'group') {
    members = groupMembers(conv.id);
  } else {
    members = [];
  }

  res.json({ success: true, members });
});

// POST /messages/conversations/:id/read — mark conversation as read
router.post('/conversations/:id/read', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const lastReadAt = touchRead(conv.id, req.user.id);
  res.json({ success: true });
  broadcastReadReceipt(conv, req.user.id, lastReadAt);
});

// GET /messages/conversations/:id/read-status — other members' last_read_at (DM/group only)
router.get('/conversations/:id/read-status', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  if (conv.type === 'department') return res.json({ success: true, members: [] });

  const members = db.prepare(`
    SELECT cm.user_id as id, u.full_name, cm.last_read_at
    FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id=? AND cm.user_id != ?
  `).all(conv.id, req.user.id);

  res.json({ success: true, members });
});

// POST /messages/conversations/:id/typing — notify other members that I'm typing
router.post('/conversations/:id/typing', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const memberIds = conv.type === 'department'
    ? db.prepare("SELECT id FROM users WHERE is_active=1 AND id != ?").all(req.user.id).map(r => r.id)
    : db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id != ?").all(conv.id, req.user.id).map(r => r.user_id);

  res.json({ success: true });
  broadcastToUsers(memberIds, 'typing', { conversation_id: conv.id, user_id: req.user.id, full_name: req.user.name || req.user.username });
});

// POST /messages/conversations/:convId/messages/:msgId/react — toggle an emoji reaction
router.post('/conversations/:convId/messages/:msgId/react', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.convId), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const emoji = (req.body?.emoji || '').trim();
  if (!emoji) return res.status(400).json({ success: false, message: 'Emoji required.' });

  const msg = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=?").get(Number(req.params.msgId), conv.id);
  if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });

  const existing = db.prepare("SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?").get(msg.id, req.user.id, emoji);
  if (existing) {
    db.prepare("DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?").run(msg.id, req.user.id, emoji);
  } else {
    db.prepare("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)").run(msg.id, req.user.id, emoji);
  }

  const reactions = getReactions(msg.id);
  res.json({ success: true, reactions });

  const recipientIds = conv.type === 'department'
    ? db.prepare("SELECT id FROM users WHERE is_active=1").all().map(r => r.id)
    : db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conv.id).map(r => r.user_id);
  broadcastToUsers(recipientIds, 'reaction', { conversation_id: conv.id, message_id: msg.id, reactions });
});

// GET /messages/conversations/:id/pinned — the conversation's pinned announcement, if any
router.get('/conversations/:id/pinned', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });
  res.json({ success: true, pinned: getPinnedMessage(conv.id) });
});

// POST /messages/conversations/:convId/messages/:msgId/pin — pin as the conversation's
// announcement (managers and above only); replaces any previously pinned message.
router.post('/conversations/:convId/messages/:msgId/pin', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.convId), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });
  if (!isManager(req.user.role)) return res.status(403).json({ success: false, message: 'Manager access required.' });

  const msg = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=?").get(Number(req.params.msgId), conv.id);
  if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });

  db.prepare("UPDATE messages SET pinned_at=NULL, pinned_by=NULL WHERE conversation_id=? AND pinned_at IS NOT NULL").run(conv.id);
  db.prepare("UPDATE messages SET pinned_at=datetime('now','localtime'), pinned_by=? WHERE id=?")
    .run(req.user.name || req.user.username, msg.id);

  const pinned = getPinnedMessage(conv.id);
  res.json({ success: true, pinned });

  const recipientIds = conv.type === 'department'
    ? db.prepare("SELECT id FROM users WHERE is_active=1").all().map(r => r.id)
    : db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conv.id).map(r => r.user_id);
  broadcastToUsers(recipientIds, 'pin', { conversation_id: conv.id, pinned });
});

// POST /messages/conversations/:convId/messages/:msgId/unpin
router.post('/conversations/:convId/messages/:msgId/unpin', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.convId), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });
  if (!isManager(req.user.role)) return res.status(403).json({ success: false, message: 'Manager access required.' });

  const msg = db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=?").get(Number(req.params.msgId), conv.id);
  if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });

  db.prepare("UPDATE messages SET pinned_at=NULL, pinned_by=NULL WHERE id=?").run(msg.id);

  res.json({ success: true, pinned: null });

  const recipientIds = conv.type === 'department'
    ? db.prepare("SELECT id FROM users WHERE is_active=1").all().map(r => r.id)
    : db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conv.id).map(r => r.user_id);
  broadcastToUsers(recipientIds, 'pin', { conversation_id: conv.id, pinned: null });
});

// GET /messages/search?q=...&conversationId=optional&senderId=optional&from=YYYY-MM-DD&to=YYYY-MM-DD&before=messageId
const SEARCH_PAGE_SIZE = 30;
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, results: [], hasMore: false });

  let conversationIds;
  if (req.query.conversationId) {
    const conv = getAccessibleConversation(Number(req.query.conversationId), req.user);
    if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });
    conversationIds = [conv.id];
  } else {
    ensureAllDeptConversations();
    const deptIds = db.prepare("SELECT id FROM conversations WHERE type='department'").all().map(r => r.id);
    const memberIds = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id=?").all(req.user.id).map(r => r.conversation_id);
    conversationIds = [...new Set([...deptIds, ...memberIds])];
  }

  if (!conversationIds.length) return res.json({ success: true, results: [], hasMore: false });

  const senderId = req.query.senderId ? Number(req.query.senderId) : null;
  const from     = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to       = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : null;
  const before   = req.query.before ? Number(req.query.before) : null;

  const placeholders = conversationIds.map(() => '?').join(',');
  let sql = `
    SELECT m.id as message_id, m.conversation_id, m.content, m.sender_id, m.sender_name, m.created_at,
           c.type as conv_type, c.dept_id
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id IN (${placeholders}) AND m.content LIKE ?
  `;
  const params = [...conversationIds, `%${q}%`];
  if (senderId) { sql += ' AND m.sender_id = ?';     params.push(senderId); }
  if (from)     { sql += ' AND m.created_at >= ?';   params.push(`${from} 00:00:00`); }
  if (to)       { sql += ' AND m.created_at <= ?';   params.push(`${to} 23:59:59`); }
  if (before)   { sql += ' AND m.id < ?';            params.push(before); }
  sql += ' ORDER BY m.id DESC LIMIT ?';
  params.push(SEARCH_PAGE_SIZE);

  const rows = db.prepare(sql).all(...params);

  const results = rows.map(r => {
    let conversation_name;
    if (r.conv_type === 'department') {
      conversation_name = deptLabel(r.dept_id);
    } else if (r.conv_type === 'group') {
      const others = groupMembers(r.conversation_id).filter(m => m.id !== req.user.id);
      conversation_name = others.map(o => o.full_name).join(', ');
    } else {
      const other = db.prepare(`
        SELECT u.full_name FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id=? AND cm.user_id != ?
      `).get(r.conversation_id, req.user.id);
      conversation_name = other?.full_name || '—';
    }
    return {
      message_id: r.message_id,
      conversation_id: r.conversation_id,
      conversation_type: r.conv_type,
      conversation_name,
      dept_id: r.conv_type === 'department' ? r.dept_id : undefined,
      content: r.content,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      created_at: r.created_at,
    };
  });

  res.json({ success: true, results, hasMore: rows.length === SEARCH_PAGE_SIZE });
});

// POST /messages/conversations/:id/hide — tuck a chat away in the "hidden" section.
// Purely a per-user display preference: notifications/unread counts are unaffected.
router.post('/conversations/:id/hide', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  ensureMembership(conv.id, req.user.id);
  db.prepare("UPDATE conversation_members SET hidden_at = datetime('now','localtime') WHERE conversation_id=? AND user_id=?")
    .run(conv.id, req.user.id);
  res.json({ success: true });
});

// POST /messages/conversations/:id/unhide — move a chat back to the main list
router.post('/conversations/:id/unhide', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  db.prepare("UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id=? AND user_id=?")
    .run(conv.id, req.user.id);
  res.json({ success: true });
});

// GET /messages/unread-count — total across all conversations (nav badge)
router.get('/unread-count', (req, res) => {
  ensureAllDeptConversations();

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM messages msg
    JOIN conversations c ON c.id = msg.conversation_id
    LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE msg.sender_id != ?
      AND (cm.user_id IS NOT NULL OR c.type = 'department')
      AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
  `).get(req.user.id, req.user.id).n;

  res.json({ success: true, unread: total });
});

// POST /messages/presence — heartbeat marking the user "active now"
// Optional body: { status: 'active' | 'away' | 'offline' } — 'away' is reported by
// clients that detect idle time (desktop OS idle, or browser mouse/keyboard idle);
// 'offline' is sent once on sign-out so other users see it immediately.
router.post('/presence', (req, res) => {
  const reqStatus = req.body?.status;
  const status = (reqStatus === 'away' || reqStatus === 'offline') ? reqStatus : 'active';
  db.prepare("UPDATE users SET last_seen_at = datetime('now','localtime'), presence_status = ? WHERE id=?")
    .run(status, req.user.id);
  res.json({ success: true });
});

// GET /messages/status-text — my current custom status text (e.g. "In a meeting")
router.get('/status-text', (req, res) => {
  const row = db.prepare("SELECT status_text FROM users WHERE id=?").get(req.user.id);
  res.json({ success: true, statusText: row?.status_text || '' });
});

// POST /messages/status-text — set or clear my custom status text
router.post('/status-text', (req, res) => {
  const text = (req.body?.text || '').trim().slice(0, 80);
  db.prepare("UPDATE users SET status_text = ? WHERE id=?").run(text || null, req.user.id);
  res.json({ success: true, statusText: text });
});

module.exports = router;
