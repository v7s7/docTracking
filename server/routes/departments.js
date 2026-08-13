// GET /departments — any authenticated user can fetch the department list
// This powers the staff-facing form UI (sidebar + form renderer).
const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { readConfig }  = require('../services/configService');
const { requestableDepartments } = require('../utils/serviceScope');
const chat = require('../services/chatBridge');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const { departments } = readConfig();
  res.json({ success: true, departments });
});

// GET /departments/requestable — the correspondence composer's dropdowns.
// Every department except the caller's own, each with its services narrowed to
// the request types the caller's department is allowed to send. Kept separate
// from GET / so the admin panel keeps seeing the unfiltered config.
router.get('/requestable', verifyToken, (req, res) => {
  const fromDeptId = req.user?.dept_id || '';
  if (!fromDeptId) {
    // A user with no department can't originate correspondence — the sending
    // department is always their own and there is nothing to derive it from.
    return res.json({ success: true, departments: [], fromDeptId: '', noDepartment: true });
  }
  // The label travels with the id so the composer never has to look it up in
  // the client-side groupLabels map — that map is maintained by hand and goes
  // stale the moment a department is added through the Super Admin panel.
  const { departments = [] } = readConfig();
  const own = departments.find(d => d.id === fromDeptId);

  // Naming the approver up front turns "goes to your head for approval" from a
  // vague promise into something the sender can verify before they hit send.
  // Only the names travel — never the phone numbers from the directory.
  // Presence travels with the name so the composer can say whether the person
  // who must approve this is actually at their desk.
  const withPresence = p => {
    if (!p?.name) return null;
    const live = chat.presenceByUsername(p.username);
    return {
      name: p.name,
      ext: p.ext || live?.ext || null,
      online: live?.online || false,
      last_seen_at: live?.last_seen_at || null,
      has_account: !!live,
    };
  };
  const approver = own
    ? { head: withPresence(own.head), deputy: withPresence(own.deputy) }
    : { head: null, deputy: null };

  res.json({
    success: true,
    fromDeptId,
    fromDeptLabel: own?.label || fromDeptId,
    approver,
    departments: requestableDepartments(fromDeptId),
  });
});

module.exports = router;
