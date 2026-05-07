// server/routes/auth.js
const express = require('express');
const jwt     = require('jsonwebtoken');
const { authenticateUser }                   = require('../services/ldapService');
const { mapGroupsToRole, extractGroupNames } = require('../utils/roleMapper');
const { verifyToken }                        = require('../middleware/authMiddleware');

const router = express.Router();

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// Usernames/emails listed here always receive SUPER_ADMIN regardless of AD groups.
// Set in .env as: SUPER_ADMIN_USERS=a.alkubaesy,another.user@swd.bh
function getSuperAdminOverrides() {
  return (process.env.SUPER_ADMIN_USERS || '')
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean);
}

function resolveRole(ldapUser, groupRole) {
  const overrides = getSuperAdminOverrides();
  const isSuperAdmin =
    overrides.includes(ldapUser.username.toLowerCase()) ||
    overrides.includes(ldapUser.email.toLowerCase());
  return isSuperAdmin ? 'SUPER_ADMIN' : groupRole;
}

// ── POST /auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  try {
    const ldapUser = await authenticateUser(username.trim(), password);

    const groupRole = mapGroupsToRole(ldapUser.memberOf);
    const role      = resolveRole(ldapUser, groupRole);
    const groups    = extractGroupNames(ldapUser.memberOf);

    const payload = {
      username:   ldapUser.username,
      name:       ldapUser.name,
      email:      ldapUser.email,
      department: ldapUser.department,
      role,
      groups,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    console.log(`[Auth] Login OK: ${ldapUser.username} → role=${role} groups=[${groups.join(', ')}]`);
    return res.status(200).json({ success: true, token, user: payload });

  } catch (err) {
    const code = err.code || 'LDAP_ERROR';
    console.warn(`[Auth] Login FAILED for "${username}": [${code}] ${err.message}`);

    if (code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    if (code === 'LDAP_UNREACHABLE') {
      return res.status(503).json({ success: false, message: 'Authentication service is temporarily unavailable. Please try again later.' });
    }
    if (code === 'USER_NOT_FOUND') {
      return res.status(401).json({ success: false, message: 'User account not found in directory.' });
    }
    return res.status(500).json({ success: false, message: 'An unexpected authentication error occurred.' });
  }
});

// ── GET /auth/me ────────────────────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
  return res.status(200).json({ success: true, user: req.user });
});

// ── POST /auth/logout ───────────────────────────────────────────────────────
router.post('/logout', verifyToken, (req, res) => {
  console.log(`[Auth] Logout: ${req.user.username}`);
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
