const express = require('express');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

function canSeeAll(role) {
  return ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role);
}

router.get('/', verifyToken, (req, res) => {
  const { role, dept_id } = req.user;

  // Status counts
  const statusRows = canSeeAll(role)
    ? db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all()
    : db.prepare("SELECT status, COUNT(*) as n FROM tasks WHERE current_dept_id = ? GROUP BY status").all(dept_id || '');

  const byStatus = {};
  for (const r of statusRows) byStatus[r.status] = r.n;

  // Department load (SUPER_ADMIN / ADMIN / CS only)
  let byDept = [];
  if (canSeeAll(role)) {
    byDept = db.prepare(`
      SELECT current_dept_id as dept_id, COUNT(*) as n
      FROM tasks WHERE status != 'closed'
      GROUP BY current_dept_id ORDER BY n DESC
    `).all();
  }

  // Recent tasks (last 10)
  const recentTasks = canSeeAll(role)
    ? db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10").all()
    : db.prepare("SELECT * FROM tasks WHERE current_dept_id = ? ORDER BY created_at DESC LIMIT 10").all(dept_id || '');

  // Total users (SUPER_ADMIN only)
  const totalUsers = role === 'SUPER_ADMIN'
    ? db.prepare("SELECT COUNT(*) as n FROM users WHERE is_active = 1").get().n
    : null;

  res.json({ success: true, stats: { byStatus, byDept, recentTasks, totalUsers } });
});

module.exports = router;
