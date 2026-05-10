const express = require('express');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const router  = express.Router();
const SA_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

router.get('/', ...SA_ONLY, (req, res) => {
  const { actor, action, limit = 100, offset = 0 } = req.query;
  const where = []; const params = [];
  if (actor)  { where.push('actor_username LIKE ?'); params.push(`%${actor}%`); }
  if (action) { where.push('action = ?');            params.push(action); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const logs  = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM audit_log ${w}`).get(...params).n;
  res.json({ success: true, logs, total });
});

module.exports = router;
