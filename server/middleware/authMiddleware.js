const jwt = require('jsonwebtoken');

// Role ladder: higher weight = more privilege
const ROLE_WEIGHT = {
  READONLY:         1,
  STAFF:            2,
  CUSTOMER_SERVICE: 3,
  MANAGER:          4,
  ADMIN:            5,
  SUPER_ADMIN:      6,
};

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  // EventSource (SSE) can't set custom headers, so it passes the token as a query param.
  let token;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  } else {
    return res.status(401).json({ success: false, message: 'No token provided.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    const { db } = require('../db');

    if (req.user.jti) {
      const sess = db.prepare('SELECT jti FROM sessions WHERE jti = ?').get(req.user.jti);
      if (!sess) {
        return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
      }
    }

    // Role and department are signed into the token at login, so a Super Admin
    // changing either used to take up to JWT_EXPIRES_IN (8h) to apply — and a
    // demotion left the old privileges live for that whole window. Re-read them
    // per request; it is one primary-key lookup, next to the session check that
    // already happens here.
    if (req.user.id) {
      const row = db.prepare('SELECT role, dept_id, is_active FROM users WHERE id = ?').get(req.user.id);
      if (row) {
        if (!row.is_active) {
          return res.status(401).json({ success: false, message: 'This account has been disabled.' });
        }
        // Role, department and active status come from the row, not the token,
        // so a change takes effect on the very next request. effectiveRole() is
        // the single definition shared with both login paths — it re-applies the
        // SUPER_ADMIN_USERS override (which is not stored on the row, and must
        // not be silently stripped here) and grants مدير النظام to تقنية المعلومات.
        const { effectiveRole } = require('../utils/permissions');
        req.user.role    = effectiveRole({ ...row, username: req.user.username, email: req.user.email });
        req.user.dept_id = row.dept_id || '';
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid or malformed token.' });
  }
}

function requireRole(minRole) {
  return (req, res, next) => {
    const userW = ROLE_WEIGHT[req.user?.role] || 0;
    const minW  = ROLE_WEIGHT[minRole]        || 99;
    if (userW < minW) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires '${minRole}' or higher.`,
      });
    }
    next();
  };
}

// CS + management can create/route tasks
function requireCS(req, res, next) {
  const w = ROLE_WEIGHT[req.user?.role] || 0;
  if (w >= ROLE_WEIGHT.CUSTOMER_SERVICE) return next();
  return res.status(403).json({ success: false, message: 'Customer Service access required.' });
}

// Any authenticated staff member (STAFF and above) can create tasks
function requireStaff(req, res, next) {
  const w = ROLE_WEIGHT[req.user?.role] || 0;
  if (w >= ROLE_WEIGHT.STAFF) return next();
  return res.status(403).json({ success: false, message: 'Staff access required.' });
}

module.exports = { verifyToken, requireRole, requireCS, requireStaff, ROLE_WEIGHT };
