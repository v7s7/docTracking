// All routes here require SUPER_ADMIN.
const express = require('express');
const bcrypt  = require('bcryptjs');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const router    = express.Router();
const SA_ONLY   = [verifyToken, requireRole('SUPER_ADMIN')];
const SALT_ROUNDS = 10;

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

function safeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

// GET /users
router.get('/', ...SA_ONLY, (req, res) => {
  const users = db.prepare(
    'SELECT * FROM users ORDER BY created_at DESC'
  ).all().map(safeUser);
  res.json({ success: true, users });
});

// POST /users
router.post('/', ...SA_ONLY, (req, res) => {
  const { username, password, full_name, email, role, dept_id } = req.body || {};
  if (!username || !password || !full_name) {
    return res.status(400).json({ success: false, message: 'username, password, and full_name are required.' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, email, role, dept_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(username.trim(), hash, full_name.trim(), email || '', role, dept_id || '', req.user.username);

    const user = safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
    res.status(201).json({ success: true, user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: `Username "${username}" already exists.` });
    }
    throw e;
  }
});

// PUT /users/:id
router.put('/:id', ...SA_ONLY, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  const { full_name, email, role, dept_id, is_active, password } = req.body || {};

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role.` });
  }

  const updates = {
    full_name:  full_name  !== undefined ? full_name.trim()  : user.full_name,
    email:      email      !== undefined ? email              : user.email,
    role:       role       !== undefined ? role               : user.role,
    dept_id:    dept_id    !== undefined ? dept_id            : user.dept_id,
    is_active:  is_active  !== undefined ? (is_active ? 1 : 0) : user.is_active,
    password_hash: user.password_hash,
  };

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    updates.password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  }

  db.prepare(`
    UPDATE users SET full_name=?, email=?, role=?, dept_id=?, is_active=?, password_hash=?
    WHERE id=?
  `).run(updates.full_name, updates.email, updates.role, updates.dept_id, updates.is_active, updates.password_hash, user.id);

  res.json({ success: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

// DELETE /users/:id
router.delete('/:id', ...SA_ONLY, (req, res) => {
  if (String(req.user.id) === req.params.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
  }
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: 'User not found.' });
  res.json({ success: true });
});

module.exports = router;
