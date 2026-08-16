// GET /directory — the staff phone directory.
//
// 140 people with a 4-digit داخلي that, until now, lived only in
// config/directory.json where no query could reach it. Available to every
// authenticated user: looking up a colleague's extension is not privileged.
const express = require('express');
const { db } = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const { readConfig } = require('../services/configService');
const chat = require('../services/chatBridge');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const cfg    = readConfig().departments || [];
  const labels = Object.fromEntries(cfg.map(d => [d.id, d.label]));

  // Some numbers belong to a department rather than a person — قسم الصيانة's
  // three direct lines, for example. They have no owner to hang off, so they
  // travel separately.
  const deptLines = cfg
    .filter(d => (d.phones || []).length)
    .map(d => ({ id: d.id, label: d.label, phones: d.phones }));

  const rows = db.prepare(`
    SELECT id, username, full_name, role, dept_id, ext, mobile, email, alt_email,
           avatar_url, avatar_color, presence_status, status_text, last_seen_at
      FROM users
     WHERE is_active = 1
     ORDER BY full_name COLLATE NOCASE
  `).all();

  const users = rows.map(u => ({
    ...u,
    dept_label: labels[u.dept_id] || u.dept_id || '',
    online: (() => { try { return chat.presenceOf(u.id)?.online || false; } catch { return false; } })(),
    is_self: u.id === req.user?.id,
  }));

  res.json({ success: true, users, deptLines, total: users.length });
});

module.exports = router;
