const jwt = require('jsonwebtoken');
const { DEFAULT_EXPIRY, parseExpirySeconds } = require('../utils/expiry');

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

    // ── Sliding sessions ──────────────────────────────────────────────────
    // Someone using the system every day should never be thrown back to the
    // login screen. Once a token is past the halfway point of its life it is
    // quietly reissued, and the client swaps it in from the response header.
    //
    // The SAME jti is reused on purpose: the sessions row is what مدير النظام
    // force-logs-out against, and minting a new id every renewal would both
    // break that link and fill the table with rows for one person.
    //
    // A session that is never used still expires on its own, so a forgotten
    // login on a shared machine does not stay valid indefinitely.
    try {
      if (req.user.exp && req.user.jti) {
        const now      = Math.floor(Date.now() / 1000);
        const lifetime = parseExpirySeconds(process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRY);
        if (req.user.exp - now < lifetime / 2) {
          const { exp, iat, ...claims } = req.user;
          const fresh = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRY });
          db.prepare("UPDATE sessions SET expires_at = ? WHERE jti = ?")
            .run(new Date(Date.now() + lifetime * 1000).toISOString(), req.user.jti);
          // A header, not a body field: every route already has its own response
          // shape and none of them would carry this.
          res.set('X-Renewed-Token', fresh);
          res.set('Access-Control-Expose-Headers', 'X-Renewed-Token');
        }
      }
    } catch (e) {
      // Renewal is a convenience. If it fails the request still succeeds and the
      // existing token keeps working until it genuinely expires.
      console.warn('[Auth] token renewal skipped:', e.message);
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
