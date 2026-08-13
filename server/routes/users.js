// Most routes here require SUPER_ADMIN; the /me/avatar* routes are self-service.
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { browseAllUsers } = require('../services/ldapService');
const { readConfig } = require('../services/configService');
const { logAudit }   = require('../utils/audit');
const {
  requireUserAdmin, requireSystemAdmin, refuseEdit, assignableRoles, capabilities, isSystemAdmin,
} = require('../utils/permissions');

const router    = express.Router();
// IT only — creating and deleting accounts, and browsing Active Directory.
const SA_ONLY   = [verifyToken, requireRole('SUPER_ADMIN'), requireSystemAdmin];
// IT or الموارد البشرية — reading the list and changing organisational facts.
// The finer limits on HR live in refuseEdit(), applied per request below.
const USER_ADMIN = [verifyToken, requireUserAdmin];
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
    logAudit(req.user, 'user.role_assign', 'user', existing.id, {
      username: existing.username,
      changed: {
        role:    { from: existing.role,    to: role },
        dept_id: { from: existing.dept_id, to: dept_id || '' },
      },
    }, req.ip);
    return res.json({ success: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(existing.id)) });
  }

  const info = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, email, role, dept_id, created_by) VALUES (?, NULL, ?, ?, ?, ?, ?)'
  ).run(username.trim(), full_name, email || '', role, dept_id || '', req.user.username);

  logAudit(req.user, 'user.role_assign', 'user', info.lastInsertRowid,
    { username: username.trim(), full_name, created: true, role, dept_id: dept_id || '' }, req.ip);

  res.status(201).json({ success: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) });
});

// GET /users — IT and HR both read the whole list. HR sees system administrator
// accounts too; it simply cannot change them, and the UI marks them as such.
router.get('/', ...USER_ADMIN, (req, res) => {
  const users = db.prepare(
    'SELECT * FROM users ORDER BY created_at DESC'
  ).all().map(safeUser);
  res.json({ success: true, users, can: capabilities(req.user) });
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
    logAudit(req.user, 'user.create', 'user', user.id,
      { username: user.username, full_name: user.full_name, role, dept_id: dept_id || '' }, req.ip);
    res.status(201).json({ success: true, user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ success: false, message: `Username "${username}" already exists.` });
    }
    throw e;
  }
});

// PATCH /users/bulk — set role, department or active status on many users at once.
// Defined before PUT /:id purely for readability; the verbs differ so there is no
// route collision.
router.patch('/bulk', ...USER_ADMIN, (req, res) => {
  const { ids, role, dept_id, is_active } = req.body || {};

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: 'Select at least one user.' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ success: false, message: 'Too many users in one request.' });
  }
  if (role === undefined && dept_id === undefined && is_active === undefined) {
    return res.status(400).json({ success: false, message: 'Nothing to change.' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }
  // A typo here would scatter people into a department that does not exist, and
  // nothing downstream would notice — every list would just quietly omit them.
  if (dept_id) {
    const known = readConfig().departments.some(d => d.id === dept_id);
    if (!known) return res.status(400).json({ success: false, message: `Unknown department "${dept_id}".` });
  }

  const targets = db.prepare(
    `SELECT id, username, role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);

  // Changing your own role or switching yourself off in a bulk action is almost
  // always a slip — and it locks you out of the only screen that could undo it.
  const self = targets.find(u => u.id === req.user.id);
  if (self && (role !== undefined || is_active !== undefined)) {
    return res.status(400).json({
      success: false,
      message: 'You are in the selection. Clear yourself from it before changing role or status.',
    });
  }

  // Every target is checked, not just the first: a bulk action must not become
  // the way around a limit that applies one at a time.
  for (const target of targets) {
    const refused = refuseEdit(req.user, target, { role, dept_id, is_active });
    if (refused) return res.status(403).json({ success: false, message: `${target.username}: ${refused}` });
  }

  const sets = [], params = [];
  if (role      !== undefined) { sets.push('role = ?');      params.push(role); }
  if (dept_id   !== undefined) { sets.push('dept_id = ?');   params.push(dept_id || ''); }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  const stmt = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`);
  db.transaction(() => { for (const u of targets) stmt.run(...params, u.id); })();

  // Deactivating someone should end their session now, not at token expiry.
  // authMiddleware re-reads is_active per request, so this is belt-and-braces —
  // it also clears the row so the sessions screen tells the truth.
  if (is_active === false || is_active === 0) {
    const del = db.prepare('DELETE FROM sessions WHERE username = ?');   // keyed by username, not id
    db.transaction(() => { for (const u of targets) del.run(u.username); })();
  }

  // One entry for the whole action, naming everyone it touched and what they
  // were before. A sweep across 50 people is exactly the change you most need
  // to be able to reconstruct later.
  logAudit(req.user, 'users.bulk_update', 'user', null, {
    changed: { role, dept_id, is_active },
    targets: targets.map(u => ({ username: u.username, was_role: u.role })),
  }, req.ip);

  const users = db.prepare(
    `SELECT * FROM users WHERE id IN (${targets.map(() => '?').join(',')})`
  ).all(...targets.map(u => u.id)).map(safeUser);

  res.json({ success: true, updated: users.length, users });
});

// PUT /users/:id
router.put('/:id', ...USER_ADMIN, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  {
    const refused = refuseEdit(req.user, user, req.body || {});
    if (refused) return res.status(403).json({ success: false, message: refused });
  }
  // Setting a password is an IT operation even on an account HR may otherwise edit.
  if ((req.body || {}).password && !isSystemAdmin(req.user)) {
    return res.status(403).json({ success: false, message: 'Only IT can set a password.' });
  }

  const { full_name, email, role, dept_id, is_active, password, ext, mobile } = req.body || {};

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role.` });
  }
  // Four digits internally; anything else is a typo that would break the
  // directory's tel: links and the search-by-extension people rely on.
  if (ext !== undefined && ext !== null && String(ext).trim() !== '' && !/^\d{3,5}$/.test(String(ext).trim())) {
    return res.status(400).json({ success: false, message: 'Extension must be 3–5 digits.' });
  }
  if (mobile !== undefined && mobile !== null && String(mobile).trim() !== ''
      && !/^[\d\s+()-]{6,20}$/.test(String(mobile).trim())) {
    return res.status(400).json({ success: false, message: 'Mobile number is not valid.' });
  }

  const clean = v => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
  const updates = {
    full_name:  full_name  !== undefined ? full_name.trim()  : user.full_name,
    email:      email      !== undefined ? email              : user.email,
    role:       role       !== undefined ? role               : user.role,
    dept_id:    dept_id    !== undefined ? dept_id            : user.dept_id,
    is_active:  is_active  !== undefined ? (is_active ? 1 : 0) : user.is_active,
    ext:        ext        !== undefined ? clean(ext)         : user.ext,
    mobile:     mobile     !== undefined ? clean(mobile)      : user.mobile,
    password_hash: user.password_hash,
  };

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    updates.password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  }

  db.prepare(`
    UPDATE users SET full_name=?, email=?, role=?, dept_id=?, is_active=?, ext=?, mobile=?, password_hash=?
    WHERE id=?
  `).run(updates.full_name, updates.email, updates.role, updates.dept_id, updates.is_active,
         updates.ext, updates.mobile, updates.password_hash, user.id);

  // Record only what actually moved, so the log reads as a list of changes
  // rather than a wall of unchanged fields.
  const diff = {};
  for (const k of ['full_name', 'email', 'role', 'dept_id', 'is_active', 'ext', 'mobile']) {
    if (String(user[k] ?? '') !== String(updates[k] ?? '')) diff[k] = { from: user[k], to: updates[k] };
  }
  if (password) diff.password = 'reset';
  if (Object.keys(diff).length) {
    logAudit(req.user, 'user.update', 'user', user.id, { username: user.username, changed: diff }, req.ip);
  }

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
  // Read it first — after the delete there is nothing left to name in the log.
  const gone = db.prepare('SELECT username, full_name, role, dept_id FROM users WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ success: false, message: 'User not found.' });
  logAudit(req.user, 'user.delete', 'user', req.params.id, gone, req.ip);
  res.json({ success: true });
});

module.exports = router;
