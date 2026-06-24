// server/routes/admin.js
// All routes here are gated behind SUPER_ADMIN.
const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { readConfig, writeConfig }  = require('../services/configService');
const { runReminderCheck }         = require('../services/reminderService');

const router    = express.Router();
const SUPER_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

const VALID_FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];

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
  res.json({ success: true, departments: readConfig().departments });
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
  res.json({ success: true, services: dept.services || [] });
});

router.post('/departments/:id/services', ...SUPER_ONLY, (req, res) => {
  const { label, description } = req.body || {};
  if (!label) return res.status(400).json({ success: false, message: '`label` is required.' });

  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  if (!dept.services) dept.services = [];

  const id = (req.params.id + '_' + label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (dept.services.find(s => s.id === id)) {
    return res.status(409).json({ success: false, message: `Service id "${id}" already exists.` });
  }

  const service = {
    id,
    label: label.trim(),
    description: (description || '').trim(),
    fields: [],
  };
  dept.services.push(service);
  writeConfig(cfg);
  res.status(201).json({ success: true, service });
});

router.put('/departments/:id/services/:svcId', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  const idx = (dept.services || []).findIndex(s => s.id === req.params.svcId);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Service not found.' });

  const { label, description } = req.body || {};
  if (label       !== undefined) dept.services[idx].label       = label.trim();
  if (description !== undefined) dept.services[idx].description = description.trim();
  writeConfig(cfg);
  res.json({ success: true, service: dept.services[idx] });
});

router.delete('/departments/:id/services/:svcId', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });

  const before = (dept.services || []).length;
  dept.services = (dept.services || []).filter(s => s.id !== req.params.svcId);
  if (dept.services.length === before) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }
  writeConfig(cfg);
  res.json({ success: true });
});

// ── Fields (per service) ──────────────────────────────────────────────────

function findService(cfg, deptId, svcId) {
  const dept = cfg.departments.find(d => d.id === deptId);
  if (!dept) return { err: 'Department not found.' };
  const svc = (dept.services || []).find(s => s.id === svcId);
  if (!svc) return { err: 'Service not found.' };
  return { dept, svc };
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

module.exports = router;
