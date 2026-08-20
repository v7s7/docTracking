// server/routes/admin.js
// All routes here are gated behind SUPER_ADMIN.
const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { readConfig, writeConfig }  = require('../services/configService');
const { runReminderCheck }         = require('../services/reminderService');
const { runChatReminderCheck }     = require('../services/chatReminderService');

const router    = express.Router();
const SUPER_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

const VALID_FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];

// A service may restrict which departments are allowed to request it, via a
// `fromDepts` array of department ids. Omitted or empty means "any department".
// Returns { error } on bad input, or { value } holding the normalised array.
function parseFromDepts(raw, cfg) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: [] };
  if (!Array.isArray(raw)) return { error: '`fromDepts` must be an array of department ids.' };

  const known = new Set(cfg.departments.map(d => d.id));
  const seen  = new Set();
  for (const id of raw) {
    if (typeof id !== 'string' || !id.trim()) {
      return { error: '`fromDepts` entries must be non-empty department ids.' };
    }
    if (!known.has(id)) {
      return { error: `Unknown department id in fromDepts: "${id}".` };
    }
    seen.add(id);
  }
  return { value: [...seen] };
}

// A department's subjects live in two arrays, and both are editable here:
//   services — what it RECEIVES; scoped by `fromDepts` (who may ask)
//   outgoing — what it ISSUES;   scoped by `toDepts`   (who may receive)
// Everything below finds a subject in whichever array holds it, so the admin
// screen never silently hides half a department's list.
function locateService(dept, svcId) {
  let idx = (dept.services || []).findIndex(s => s.id === svcId);
  if (idx !== -1) return { list: dept.services, idx, direction: 'request', scopeKey: 'fromDepts' };
  idx = (dept.outgoing || []).findIndex(s => s.id === svcId);
  if (idx !== -1) return { list: dept.outgoing, idx, direction: 'issue', scopeKey: 'toDepts' };
  return null;
}

function listServices(dept) {
  return [
    ...(dept.outgoing || []).map(s => ({ ...s, direction: 'issue',   scope: s.toDepts   || [] })),
    ...(dept.services || []).map(s => ({ ...s, direction: 'request', scope: s.fromDepts || [] })),
  ];
}

// ── Full config export/import ─────────────────────────────────────────────

router.get('/config', ...SUPER_ONLY, (req, res) => {
  res.json({ success: true, config: readConfig() });
});

router.put('/config', ...SUPER_ONLY, (req, res) => {
  const { config } = req.body || {};
  if (!config || !Array.isArray(config.departments) || typeof config.roleGroupMap !== 'object') {
    return res.status(400).json({ success: false, message: 'Payload must have { config: { departments[], roleGroupMap{} } }.' });
  }
  writeConfig(config);
  res.json({ success: true, message: 'Configuration replaced.' });
});

// ── Departments ───────────────────────────────────────────────────────────

router.get('/departments', ...SUPER_ONLY, (req, res) => {
  // `services` is flattened across both directions here so the admin screen
  // shows a department's whole subject list. Each entry carries `direction` and
  // `scope`; the write endpoints below route it back to the right array.
  const departments = readConfig().departments.map(d => ({ ...d, services: listServices(d) }));
  res.json({ success: true, departments });
});

router.post('/departments', ...SUPER_ONLY, (req, res) => {
  const { label, ldapGroup } = req.body || {};
  if (!label) return res.status(400).json({ success: false, message: '`label` is required.' });

  const id  = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const cfg = readConfig();

  if (cfg.departments.find(d => d.id === id)) {
    return res.status(409).json({ success: false, message: `Department id "${id}" already exists.` });
  }

  const dept = { id, label: label.trim(), ldapGroup: (ldapGroup || '').trim(), services: [] };
  cfg.departments.push(dept);
  writeConfig(cfg);
  res.status(201).json({ success: true, department: dept });
});

router.put('/departments/:id', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  const idx = cfg.departments.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Department not found.' });

  const { label, ldapGroup } = req.body || {};
  if (label)               cfg.departments[idx].label     = label.trim();
  if (ldapGroup !== undefined) cfg.departments[idx].ldapGroup = ldapGroup.trim();
  writeConfig(cfg);
  res.json({ success: true, department: cfg.departments[idx] });
});

router.delete('/departments/:id', ...SUPER_ONLY, (req, res) => {
  const cfg    = readConfig();
  const before = cfg.departments.length;
  cfg.departments = cfg.departments.filter(d => d.id !== req.params.id);
  if (cfg.departments.length === before) {
    return res.status(404).json({ success: false, message: 'Department not found.' });
  }
  writeConfig(cfg);
  res.json({ success: true });
});

// ── Services (per department) ─────────────────────────────────────────────

router.get('/departments/:id/services', ...SUPER_ONLY, (req, res) => {
  const dept = readConfig().departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
  res.json({ success: true, services: listServices(dept) });
});

router.post('/departments/:id/services', ...SUPER_ONLY, (req, res) => {
  const { label, description, fromDepts, toDepts, direction } = req.body || {};
  if (!label) return res.status(400).json({ success: false, message: '`label` is required.' });
  if (direction !== undefined && direction !== 'request' && direction !== 'issue') {
    return res.status(400).json({ success: false, message: '`direction` must be "request" or "issue".' });
  }

  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  const isIssue  = direction === 'issue';
  const scopeKey = isIssue ? 'toDepts' : 'fromDepts';
  const parsed   = parseFromDepts(isIssue ? toDepts : fromDepts, cfg);
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

  if (!dept.services) dept.services = [];
  if (!dept.outgoing) dept.outgoing = [];
  // Ids must be unique across BOTH arrays — servicesBetween() unions them, so a
  // collision would make one subject shadow the other.
  const taken = new Set([...dept.services, ...dept.outgoing].map(s => s.id));

  // Arabic labels transliterate to nothing under [^a-z0-9], which would collapse
  // every service on a department to the same id — fall back to a numeric suffix.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let id = slug ? `${req.params.id}_${slug}` : `${req.params.id}_svc`;
  if (taken.has(id)) {
    if (slug) {
      return res.status(409).json({ success: false, message: `Service id "${id}" already exists.` });
    }
    let n = 2;
    while (taken.has(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }

  const service = {
    id,
    label: label.trim(),
    description: (description || '').trim(),
    fields: [],
    [scopeKey]: parsed.value || [],
  };
  (isIssue ? dept.outgoing : dept.services).push(service);
  writeConfig(cfg);
  res.status(201).json({ success: true, service });
});

router.put('/departments/:id/services/:svcId', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  const found = locateService(dept, req.params.svcId);
  if (!found) return res.status(404).json({ success: false, message: 'Service not found.' });
  const { list, idx, direction, scopeKey } = found;

  const { label, description, fromDepts, toDepts } = req.body || {};

  // The scope field the caller sends is read from whichever key matches this
  // subject's direction, so an outgoing subject can never grow a `fromDepts`.
  const rawScope = scopeKey === 'toDepts'
    ? (toDepts !== undefined ? toDepts : fromDepts)
    : (fromDepts !== undefined ? fromDepts : toDepts);
  const parsed = parseFromDepts(rawScope, cfg);
  if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

  if (label        !== undefined) list[idx].label       = label.trim();
  if (description  !== undefined) list[idx].description = description.trim();
  if (parsed.value !== undefined) list[idx][scopeKey]   = parsed.value;
  writeConfig(cfg);
  res.json({ success: true, service: { ...list[idx], direction, scope: list[idx][scopeKey] || [] } });
});

router.delete('/departments/:id/services/:svcId', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  const found = locateService(dept, req.params.svcId);
  if (!found) return res.status(404).json({ success: false, message: 'Service not found.' });
  found.list.splice(found.idx, 1);
  writeConfig(cfg);
  res.json({ success: true });
});

// ── Fields (per service) ──────────────────────────────────────────────────

function findService(cfg, deptId, svcId) {
  const dept = cfg.departments.find(d => d.id === deptId);
  if (!dept) return { err: 'Department not found.' };
  const found = locateService(dept, svcId);
  if (!found) return { err: 'Service not found.' };
  return { dept, svc: found.list[found.idx] };
}

router.get('/departments/:id/services/:svcId/fields', ...SUPER_ONLY, (req, res) => {
  const { err, svc } = findService(readConfig(), req.params.id, req.params.svcId);
  if (err) return res.status(404).json({ success: false, message: err });
  res.json({ success: true, fields: svc.fields || [] });
});

router.post('/departments/:id/services/:svcId/fields', ...SUPER_ONLY, (req, res) => {
  const { key, label, type, required, options, placeholder } = req.body || {};
  if (!key || !label || !type) {
    return res.status(400).json({ success: false, message: '`key`, `label`, and `type` are required.' });
  }
  if (!VALID_FIELD_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${VALID_FIELD_TYPES.join(', ')}.` });
  }

  const cfg = readConfig();
  const { err, svc } = findService(cfg, req.params.id, req.params.svcId);
  if (err) return res.status(404).json({ success: false, message: err });

  if (!svc.fields) svc.fields = [];
  if (svc.fields.find(f => f.key === key)) {
    return res.status(409).json({ success: false, message: `Field "${key}" already exists in this service.` });
  }

  const field = {
    key: key.trim(),
    label: label.trim(),
    type,
    required: !!required,
    ...(type === 'select' && options ? { options: (Array.isArray(options) ? options : options.split(',').map(x => x.trim()).filter(Boolean)) } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  svc.fields.push(field);
  writeConfig(cfg);
  res.status(201).json({ success: true, field });
});

router.put('/departments/:id/services/:svcId/fields/:key', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  const { err, svc } = findService(cfg, req.params.id, req.params.svcId);
  if (err) return res.status(404).json({ success: false, message: err });

  const fidx = (svc.fields || []).findIndex(f => f.key === req.params.key);
  if (fidx === -1) return res.status(404).json({ success: false, message: 'Field not found.' });

  const { label, type, required, options, placeholder } = req.body || {};
  const updated = { ...svc.fields[fidx] };
  if (label       !== undefined) updated.label    = label.trim();
  if (type        !== undefined) updated.type     = type;
  if (required    !== undefined) updated.required = !!required;
  if (options     !== undefined) updated.options  = Array.isArray(options) ? options : options.split(',').map(x => x.trim()).filter(Boolean);
  if (placeholder !== undefined) updated.placeholder = placeholder;

  svc.fields[fidx] = updated;
  writeConfig(cfg);
  res.json({ success: true, field: updated });
});

router.delete('/departments/:id/services/:svcId/fields/:key', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  const { err, svc } = findService(cfg, req.params.id, req.params.svcId);
  if (err) return res.status(404).json({ success: false, message: err });

  const before = (svc.fields || []).length;
  svc.fields = (svc.fields || []).filter(f => f.key !== req.params.key);
  if (svc.fields.length === before) {
    return res.status(404).json({ success: false, message: 'Field not found.' });
  }
  writeConfig(cfg);
  res.json({ success: true });
});

// ── Role Group Map ────────────────────────────────────────────────────────

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'READONLY'];

router.get('/role-map', ...SUPER_ONLY, (req, res) => {
  res.json({ success: true, roleGroupMap: readConfig().roleGroupMap || {} });
});

router.put('/role-map', ...SUPER_ONLY, (req, res) => {
  const { ldapGroup, role } = req.body || {};
  if (!ldapGroup || !VALID_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: `Provide { ldapGroup (string), role (${VALID_ROLES.join('|')}) }.`,
    });
  }
  const cfg = readConfig();
  cfg.roleGroupMap = cfg.roleGroupMap || {};
  cfg.roleGroupMap[ldapGroup.toLowerCase().trim()] = role;
  writeConfig(cfg);
  res.json({ success: true, roleGroupMap: cfg.roleGroupMap });
});

router.delete('/role-map/:group', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  cfg.roleGroupMap = cfg.roleGroupMap || {};
  delete cfg.roleGroupMap[decodeURIComponent(req.params.group).toLowerCase()];
  writeConfig(cfg);
  res.json({ success: true, roleGroupMap: cfg.roleGroupMap });
});

// ── Reminders (manual trigger) ────────────────────────────────────────────

router.post('/reminders/run', ...SUPER_ONLY, async (req, res) => {
  try {
    const result = await runReminderCheck();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/chat-reminders/run', ...SUPER_ONLY, async (req, res) => {
  try {
    const result = await runChatReminderCheck();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Email master switch ───────────────────────────────────────────────────
// A runtime toggle so the system can be demonstrated, or tested against real
// data, without mailing the whole organisation. Everything else — in-app
// notifications, badges, read receipts — is unaffected either way.
router.get('/email-switch', ...SUPER_ONLY, (req, res) => {
  res.json({ success: true, ...emailStatus() });
});

router.put('/email-switch', ...SUPER_ONLY, (req, res) => {
  const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
  setSetting('email_enabled', enabled ? 'true' : 'false', req.user?.username);
  logAudit(req.user, enabled ? 'EMAIL_ENABLED' : 'EMAIL_DISABLED', 'setting', 'email_enabled', null, req.ip);
  // Printed to the server console so the state is visible to whoever is
  // watching the window, not only to whoever clicked it.
  console.log(`[Mail] switch turned ${enabled ? 'ON' : 'OFF'} by ${req.user?.username || 'unknown'}`);
  res.json({ success: true, ...emailStatus() });
});

module.exports = router;
