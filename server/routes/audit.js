const express = require('express');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const { canManageUsers, isSystemAdmin } = require('../utils/permissions');

const router = express.Router();

// IT reads the whole log. الموارد البشرية reads only the part it is accountable
// for — changes to user accounts — because the rest of the log covers system
// configuration, which is not HR's business and would be an odd thing to widen
// access to as a side effect of letting HR manage people.
const USER_ACTIONS = ['user.create', 'user.update', 'user.delete', 'user.role_assign', 'users.bulk_update'];

router.get('/', verifyToken, (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to view the change history.' });
  }

  const { actor, action, limit = 100, offset = 0 } = req.query;
  const where = []; const params = [];

  if (!isSystemAdmin(req.user)) {
    where.push(`action IN (${USER_ACTIONS.map(() => '?').join(',')})`);
    params.push(...USER_ACTIONS);
  }
  if (actor)  { where.push('actor_username LIKE ?'); params.push(`%${actor}%`); }
  if (action) { where.push('action = ?');            params.push(action); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const n = Math.min(Number(limit) || 100, 500);
  const logs  = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, n, Number(offset) || 0);
  const total = db.prepare(`SELECT COUNT(*) as n FROM audit_log ${w}`).get(...params).n;
  res.json({ success: true, logs, total });
});

module.exports = router;
