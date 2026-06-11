const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const { readConfig }  = require('../services/configService');

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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
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

// CS-tier roles share the "customer_service" department conversation.
function effectiveDeptId(user) {
  if (['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user.role)) {
    return user.dept_id || 'customer_service';
  }
  return user.dept_id || null;
}

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

function ensureMembership(conversationId, userId) {
  const row = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId, userId);
  if (!row) {
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)").run(conversationId, userId);
  }
}

function touchRead(conversationId, userId) {
  ensureMembership(conversationId, userId);
  db.prepare("UPDATE conversation_members SET last_read_at = datetime('now','localtime') WHERE conversation_id=? AND user_id=?")
    .run(conversationId, userId);
}

// Returns the conversation row if the user may access it, else null
function getAccessibleConversation(conversationId, user) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(conversationId);
  if (!conv) return null;
  if (conv.type === 'department') {
    return conv.dept_id === effectiveDeptId(user) ? conv : null;
  }
  const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId, user.id);
  return member ? conv : null;
}

// GET /messages/directory — colleagues available to start a DM with
router.get('/directory', (req, res) => {
  const users = db.prepare(
    "SELECT id, full_name, role, dept_id, last_seen_at FROM users WHERE is_active=1 AND id != ? ORDER BY full_name COLLATE NOCASE"
  ).all(req.user.id);
  res.json({ success: true, users });
});

// GET /messages/conversations — list my conversations (DMs + my department)
router.get('/conversations', (req, res) => {
  const myDept = effectiveDeptId(req.user);
  if (myDept) {
    const deptConv = ensureDeptConversation(myDept);
    ensureMembership(deptConv.id, req.user.id);
  }

  const rows = db.prepare(`
    SELECT c.*, cm.last_read_at
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = ?
  `).all(req.user.id);

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
    } else {
      const other = db.prepare(`
        SELECT u.id, u.full_name, u.role, u.dept_id, u.last_seen_at
        FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.user_id != ?
      `).get(conv.id, req.user.id);
      display = { name: other?.full_name || '—', other_user: other };
    }

    return {
      id: conv.id,
      type: conv.type,
      ...display,
      unread,
      last_message: last || null,
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
  const other = db.prepare("SELECT id, full_name, role, dept_id, last_seen_at FROM users WHERE id=? AND is_active=1").get(otherId);
  if (!other) return res.status(404).json({ success: false, message: 'User not found.' });

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

// GET /messages/conversations/:id/messages — fetch (optionally only messages after a given id, for polling)
router.get('/conversations/:id/messages', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  const after = req.query.after ? Number(req.query.after) : 0;
  const messages = db.prepare(
    "SELECT * FROM messages WHERE conversation_id=? AND id > ? ORDER BY id ASC"
  ).all(conv.id, after);

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

  const info = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, sender_name, content, file_url, file_name, file_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conv.id, req.user.id, req.user.name || req.user.username, content || null,
    file ? `/uploads/messages/${file.filename}` : null,
    file ? file.originalname : null,
    file ? file.mimetype : null,
    file ? file.size : null,
  );

  touchRead(conv.id, req.user.id);

  const message = db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid);
  res.status(201).json({ success: true, message });
});

// POST /messages/conversations/:id/read — mark conversation as read
router.post('/conversations/:id/read', (req, res) => {
  const conv = getAccessibleConversation(Number(req.params.id), req.user);
  if (!conv) return res.status(403).json({ success: false, message: 'Access denied.' });

  touchRead(conv.id, req.user.id);
  res.json({ success: true });
});

// GET /messages/unread-count — total across all conversations (nav badge)
router.get('/unread-count', (req, res) => {
  const myDept = effectiveDeptId(req.user);
  if (myDept) {
    const deptConv = ensureDeptConversation(myDept);
    ensureMembership(deptConv.id, req.user.id);
  }

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM messages msg
    JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = ?
    WHERE msg.sender_id != ? AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
  `).get(req.user.id, req.user.id).n;

  res.json({ success: true, unread: total });
});

// POST /messages/presence — heartbeat marking the user "active now"
router.post('/presence', (req, res) => {
  db.prepare("UPDATE users SET last_seen_at = datetime('now','localtime') WHERE id=?").run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
