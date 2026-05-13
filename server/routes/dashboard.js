const express = require('express');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

function canSeeAll(role) {
  return ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role);
}

router.get('/', verifyToken, (req, res) => {
  const { role, dept_id } = req.user;
  const filterDept = canSeeAll(role) && req.query.dept ? req.query.dept : (!canSeeAll(role) ? dept_id || '' : null);

  const statusRows = filterDept !== null
    ? db.prepare("SELECT status, COUNT(*) as n FROM tasks WHERE current_dept_id = ? GROUP BY status").all(filterDept)
    : db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all();

  const byStatus = {};
  for (const r of statusRows) byStatus[r.status] = r.n;

  let byDept = [];
  if (canSeeAll(role) && filterDept === null) {
    byDept = db.prepare("SELECT current_dept_id as dept_id, COUNT(*) as n FROM tasks WHERE status != 'closed' GROUP BY current_dept_id ORDER BY n DESC").all();
  }

  const recentTasks = filterDept !== null
    ? db.prepare("SELECT * FROM tasks WHERE current_dept_id = ? ORDER BY created_at DESC LIMIT 10").all(filterDept)
    : db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10").all();

  const totalUsers = role === 'SUPER_ADMIN'
    ? db.prepare("SELECT COUNT(*) as n FROM users WHERE is_active = 1").get().n
    : null;

  res.json({ success: true, stats: { byStatus, byDept, recentTasks, totalUsers } });
});

module.exports = router;
