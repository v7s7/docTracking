// GET /departments — any authenticated user can fetch the department list
// This powers the staff-facing form UI (sidebar + form renderer).
const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { readConfig }  = require('../services/configService');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const { departments } = readConfig();
  res.json({ success: true, departments });
});

module.exports = router;
