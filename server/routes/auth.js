const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { db }   = require('../db');
const { authenticateUser }                   = require('../services/ldapService');
const { mapGroupsToRole, extractGroupNames } = require('../utils/roleMapper');
const { verifyToken }                        = require('../middleware/authMiddleware');

const router         = express.Router();
const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

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
      dept_id:  localUser.dept_id || '',
      is_local: true,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    console.log(`[Auth] Local login OK: ${localUser.username} → role=${role}`);
    return res.json({ success: true, token, user: payload });
  }

  // 2. Fall back to LDAP
  if (!process.env.LDAP_URL) {
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  }

  try {
    const ldapUser  = await authenticateUser(username.trim(), password);
    const groupRole = mapGroupsToRole(ldapUser.memberOf);
    const overrides = getSuperAdminOverrides();
    const isSA      = overrides.includes(ldapUser.username.toLowerCase())
                   || overrides.includes(ldapUser.email.toLowerCase());
    const role      = isSA ? 'SUPER_ADMIN' : groupRole;

    const payload = {
      id:       null,
      username: ldapUser.username,
      name:     ldapUser.name,
      email:    ldapUser.email,
      role,
      dept_id:  '',
      groups:   extractGroupNames(ldapUser.memberOf),
      is_local: false,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
  return res.json({ success: true, user: req.user });
});

// ── POST /auth/logout ────────────────────────────────────────
router.post('/logout', verifyToken, (req, res) => {
  console.log(`[Auth] Logout: ${req.user.username}`);
  return res.json({ success: true, message: 'Logged out.' });
});

module.exports = router;
