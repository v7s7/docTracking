const express = require('express');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

function userDeptId(user) {
  // CS and above see reception notifications; dept staff see their dept
  if (['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user.role)) {
    return user.dept_id || 'reception_dept';
  }
  return user.dept_id || '';
}

// GET /notifications — unread count + last 20
router.get('/', verifyToken, (req, res) => {
  const deptId = userDeptId(req.user);

  const unread = db.prepare(
    "SELECT COUNT(*) as n FROM notifications WHERE dept_id = ? AND is_read = 0"
  ).get(deptId).n;

  const items = db.prepare(
    "SELECT * FROM notifications WHERE dept_id = ? ORDER BY created_at DESC LIMIT 20"
  ).all(deptId);

  res.json({ success: true, unread, items });
});

// POST /notifications/read — mark all as read
router.post('/read', verifyToken, (req, res) => {
  const deptId = userDeptId(req.user);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE dept_id = ?").run(deptId);
  res.json({ success: true });
});

// POST /notifications/:id/read — mark one as read
router.post('/:id/read', verifyToken, (req, res) => {
  const deptId = userDeptId(req.user);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND dept_id = ?").run(req.params.id, deptId);
  res.json({ success: true });
});

module.exports = router;
