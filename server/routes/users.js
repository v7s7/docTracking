// Most routes here require SUPER_ADMIN; the /me/avatar* routes are self-service.
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { browseAllUsers } = require('../services/ldapService');

const router    = express.Router();
const SA_ONLY   = [verifyToken, requireRole('SUPER_ADMIN')];
const SALT_ROUNDS = 10;

const AVATAR_DIR = path.join(__dirname, '..', 'data', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_TYPES.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
    cb(null, true);
  },
});

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

function safeUser(u) {
  const { password_hash, ...rest } = u;
  return { ...rest, is_ldap: !password_hash };
}

// GET /users/ldap  — browse all Active Directory users via service account
router.get('/ldap', ...SA_ONLY, async (req, res) => {
  if (!process.env.LDAP_URL) {
    return res.json({ success: true, users: [], note: 'LDAP not configured.' });
  }
  try {
    const users = await browseAllUsers();
    return res.json({ success: true, users });
  } catch (e) {
    const code = e.code || 'LDAP_ERROR';
    console.warn('[LDAP Browse]', code, e.message);
    if (code === 'NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: e.message, code });
    }
    if (code === 49 || e.message?.includes('Invalid Credentials') || e.message?.includes('invalidCredentials')) {
      return res.status(502).json({ success: false, message: 'LDAP service account credentials are invalid.', code: 'INVALID_CREDENTIALS' });
    }
    return res.status(502).json({ success: false, message: `Could not connect to Active Directory: ${e.message}`, code });
  }
});

// POST /users/ldap-assign  — upsert a role+dept assignment for an LDAP user (no password)
router.post('/ldap-assign', ...SA_ONLY, (req, res) => {
  const { username, full_name, email, role, dept_id } = req.body || {};
  if (!username || !full_name || !role) {
    return res.status(400).json({ success: false, message: 'username, full_name and role are required.' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role.` });
  }

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    if (existing.password_hash) {
      return res.status(409).json({ success: false, message: 'This username belongs to a local password account.' });
    }
    db.prepare('UPDATE users SET full_name=?, email=?, role=?, dept_id=?, is_active=1 WHERE id=?')
      .run(full_name, email || '', role, dept_id || '', existing.id);
    return res.json({ success: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(existing.id)) });
  }

  const info = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, email, role, dept_id, created_by) VALUES (?, NULL, ?, ?, ?, ?, ?)'
  ).run(username.trim(), full_name, email || '', role, dept_id || '', req.user.username);

  res.status(201).json({ success: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) });
});

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

// POST /users/me/avatar — upload/replace the current user's own picture
router.post('/me/avatar', verifyToken, (req, res) => {
  if (!req.user.id) return res.status(403).json({ success: false, message: 'Your account is not fully set up yet.' });
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'No image provided.' });

    const old = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
    const avatar_url = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatar_url, req.user.id);

    if (old?.avatar_url) {
      const oldPath = path.join(AVATAR_DIR, path.basename(old.avatar_url));
      fs.unlink(oldPath, () => {});
    }
    res.json({ success: true, avatar_url });
  });
});

// PUT /users/me/avatar-color — pick a flat background color for the initials avatar
router.put('/me/avatar-color', verifyToken, (req, res) => {
  if (!req.user.id) return res.status(403).json({ success: false, message: 'Your account is not fully set up yet.' });
  const { color } = req.body || {};
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ success: false, message: 'Color must be a hex value like #4f46e5.' });
  }
  db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(color, req.user.id);
  res.json({ success: true, avatar_color: color });
});

// DELETE /users/me/avatar — remove the uploaded picture, fall back to initials/color
router.delete('/me/avatar', verifyToken, (req, res) => {
  if (!req.user.id) return res.status(403).json({ success: false, message: 'Your account is not fully set up yet.' });
  const old = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
  db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.user.id);
  if (old?.avatar_url) {
    const oldPath = path.join(AVATAR_DIR, path.basename(old.avatar_url));
    fs.unlink(oldPath, () => {});
  }
  res.json({ success: true });
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
