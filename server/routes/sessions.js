const express = require('express');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { logAudit } = require('../utils/audit');

const router  = express.Router();
const SA_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

// GET /sessions — list active sessions (cleanup expired first)
router.get('/', ...SA_ONLY, (req, res) => {
  // expires_at is stored as an ISO string (2026-09-14T09:17:40.639Z — a "T"
  // separator, milliseconds, "Z"). datetime('now') returns SQLite's own format
  // (2026-09-14 09:17:40 — a space, no fraction, no "Z"). Comparing those two
  // strings directly with `<` is comparing their BYTES, not their times: at the
  // point they first differ — the 10th character — one has 'T' (0x54) and the
  // other a space (0x20), and 'T' sorts after space. So any session expiring
  // today loses that comparison regardless of the clock, and sits in the table
  // looking active until its date rolls over — it grants no access (jwt.verify
  // still rejects an actually-expired token on its own exp claim), but it means
  // السجلات can show someone as "connected" for a day after they expired, and
  // the table never gets cleaned same-day. datetime(expires_at) reformats it
  // into SQLite's own canonical form first, so both sides compare as what they
  // actually are: moments in time, not byte strings.
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')").run();
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
