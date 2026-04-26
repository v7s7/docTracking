// server/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Numeric weight per role — used by requireRole to compare privilege levels
const ROLE_WEIGHT = { READONLY: 1, STAFF: 2, MANAGER: 3, ADMIN: 4 };

/**
 * Validates the Bearer JWT in the Authorization header and attaches the
 * decoded payload to req.user. Rejects with 401 on any failure.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' });
  }

  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid or malformed token.' });
  }
}

/**
 * Route-level guard. Attach after verifyToken.
 * Usage: router.get('/admin', verifyToken, requireRole('ADMIN'), handler)
 *
 * @param {'READONLY'|'STAFF'|'MANAGER'|'ADMIN'} minRole
 */
function requireRole(minRole) {
  return (req, res, next) => {
    const userWeight     = ROLE_WEIGHT[req.user?.role] || 0;
    const requiredWeight = ROLE_WEIGHT[minRole]        || 99;
    if (userWeight < requiredWeight) {
      return res.status(403).json({
        success: false,
        message: `Access denied. This resource requires the '${minRole}' role or higher.`,
      });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
