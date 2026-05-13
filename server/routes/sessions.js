const express = require('express');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { logAudit } = require('../utils/audit');

const router  = express.Router();
const SA_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

// GET /sessions — list active sessions (cleanup expired first)
router.get('/', ...SA_ONLY, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  const sessions = db.prepare('SELECT jti, username, full_name, role, ip, user_agent, created_at, expires_at FROM sessions ORDER BY created_at DESC').all();
  res.json({ success: true, sessions });
});

// DELETE /sessions/:jti — force logout one session
router.delete('/:jti', ...SA_ONLY, (req, res) => {
  if (req.params.jti === req.user.jti) {
    return res.status(400).json({ success: false, message: 'Cannot terminate your own session here. Use logout.' });
  }
  const session = db.prepare('SELECT * FROM sessions WHERE jti = ?').get(req.params.jti);
  if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
  db.prepare('DELETE FROM sessions WHERE jti = ?').run(req.params.jti);
  logAudit(req.user, 'SESSION_TERMINATED', 'session', req.params.jti, { target_user: session.username }, req.ip);
  res.json({ success: true });
});

module.exports = router;
