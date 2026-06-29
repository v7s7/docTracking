const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { randomUUID } = require('crypto');
const { db }   = require('../db');
const { authenticateUser }                   = require('../services/ldapService');
const { mapGroupsToRole, extractGroupNames } = require('../utils/roleMapper');
const { verifyToken }                        = require('../middleware/authMiddleware');
const { logAudit } = require('../utils/audit');

const router         = express.Router();
const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function parseExpiryMs(str) {
  const m = (str || '8h').match(/^(\d+)([smhd])$/);
  if (!m) return 8 * 3600 * 1000;
  return parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
}

function getSuperAdminOverrides() {
  return (process.env.SUPER_ADMIN_USERS || '')
    .split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
}

// ── POST /auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  // 1. Try local DB first
  const localUser = db.prepare(
    'SELECT * FROM users WHERE username = ? AND is_active = 1'
  ).get(username.trim());

  if (localUser && localUser.password_hash) {
    const match = bcrypt.compareSync(password, localUser.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const overrides = getSuperAdminOverrides();
    const role = overrides.includes(localUser.username.toLowerCase())
      ? 'SUPER_ADMIN'
      : localUser.role;

    const payload = {
      id:       localUser.id,
      username: localUser.username,
      name:     localUser.full_name,
      email:    localUser.email || '',
      role,
      dept_id:      localUser.dept_id || '',
      is_local:     true,
      avatar_url:   localUser.avatar_url || null,
      avatar_color: localUser.avatar_color || null,
    };

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + parseExpiryMs(JWT_EXPIRES_IN)).toISOString();
    db.prepare('INSERT OR REPLACE INTO sessions (jti, username, full_name, role, ip, user_agent, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(jti, payload.username, payload.name, payload.role, req.ip, req.headers['user-agent']||'', expiresAt);
    const token = jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    logAudit({ username: payload.username, role: payload.role }, 'USER_LOGIN', 'user', payload.username, { method: 'local' }, req.ip);
    console.log(`[Auth] Local login OK: ${localUser.username} → role=${role}`);
    return res.json({ success: true, token, user: payload });
  }

  // 2. Fall back to LDAP
  if (!process.env.LDAP_URL) {
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  }

  try {
    const ldapUser  = await authenticateUser(username.trim(), password);
    const overrides = getSuperAdminOverrides();
    const isSA      = overrides.includes(ldapUser.username.toLowerCase())
                   || overrides.includes(ldapUser.email.toLowerCase());

    // Check if an admin has assigned a role to this LDAP user in the DB
    const stored = db.prepare(
      'SELECT * FROM users WHERE username = ? AND password_hash IS NULL AND is_active = 1'
    ).get(ldapUser.username);

    // Keep name/email in sync with AD
    if (stored) {
      db.prepare('UPDATE users SET full_name=?, email=? WHERE id=?')
        .run(ldapUser.name, ldapUser.email, stored.id);
    }

    const role    = isSA ? 'SUPER_ADMIN' : (stored ? stored.role : mapGroupsToRole(ldapUser.memberOf));
    const dept_id = stored ? (stored.dept_id || '') : '';

    const payload = {
      id:       stored ? stored.id : null,
      username: ldapUser.username,
      name:     ldapUser.name,
      email:    ldapUser.email,
      role,
      dept_id,
      groups:   extractGroupNames(ldapUser.memberOf),
      is_local: false,
      avatar_url:   stored?.avatar_url || null,
      avatar_color: stored?.avatar_color || null,
    };

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + parseExpiryMs(JWT_EXPIRES_IN)).toISOString();
    db.prepare('INSERT OR REPLACE INTO sessions (jti, username, full_name, role, ip, user_agent, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(jti, payload.username, payload.name, payload.role, req.ip, req.headers['user-agent']||'', expiresAt);
    const token = jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    logAudit({ username: payload.username, role: payload.role }, 'USER_LOGIN', 'user', payload.username, { method: 'ldap' }, req.ip);
    console.log(`[Auth] LDAP login OK: ${ldapUser.username} → role=${role}`);
    return res.json({ success: true, token, user: payload });

  } catch (err) {
    const code = err.code || 'LDAP_ERROR';
    console.warn(`[Auth] Login FAILED for "${username}": [${code}] ${err.message}`);

    if (code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    if (code === 'LDAP_UNREACHABLE') {
      return res.status(503).json({ success: false, message: 'Authentication service temporarily unavailable.' });
    }
    if (code === 'USER_NOT_FOUND') {
      return res.status(401).json({ success: false, message: 'User account not found.' });
    }
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
});

// ── GET /auth/me ─────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
  // avatar_url/avatar_color can change after the token was issued, so always
  // read the latest values from the DB instead of trusting the JWT payload.
  const row = req.user.id
    ? db.prepare('SELECT avatar_url, avatar_color FROM users WHERE id = ?').get(req.user.id)
    : null;
  return res.json({ success: true, user: { ...req.user, avatar_url: row?.avatar_url || null, avatar_color: row?.avatar_color || null } });
});

// ── POST /auth/logout ────────────────────────────────────────
router.post('/logout', verifyToken, (req, res) => {
  if (req.user?.jti) {
    db.prepare('DELETE FROM sessions WHERE jti = ?').run(req.user.jti);
  }
  logAudit(req.user, 'USER_LOGOUT', 'user', req.user.username, null, req.ip);
  console.log(`[Auth] Logout: ${req.user.username}`);
  return res.json({ success: true, message: 'Logged out.' });
});

module.exports = router;
