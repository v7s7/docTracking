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
    if (req.user.jti) {
      const { db } = require('../db');
      const sess = db.prepare('SELECT jti FROM sessions WHERE jti = ?').get(req.user.jti);
      if (!sess) {
        return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
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
