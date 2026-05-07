// server/routes/admin.js
// All routes here are gated behind SUPER_ADMIN.
// They provide full runtime control over departments, workflow fields,
// LDAP group→role mappings, and the full config export/import.
const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { readConfig, writeConfig }  = require('../services/configService');

const router    = express.Router();
const SUPER_ONLY = [verifyToken, requireRole('SUPER_ADMIN')];

// ── Full config export/import ─────────────────────────────────────────────

// GET /admin/config — download the entire config as JSON
router.get('/config', ...SUPER_ONLY, (req, res) => {
  res.json({ success: true, config: readConfig() });
});

// PUT /admin/config — replace the entire config (bulk import / restore from backup)
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
  const { label, ldapGroup, fields } = req.body || {};
  if (!label) return res.status(400).json({ success: false, message: '`label` is required.' });

  const id  = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const cfg = readConfig();

  if (cfg.departments.find(d => d.id === id)) {
    return res.status(409).json({ success: false, message: `Department id "${id}" already exists.` });
  }

  const dept = { id, label: label.trim(), ldapGroup: (ldapGroup || '').trim(), fields: fields || [] };
  cfg.departments.push(dept);
  writeConfig(cfg);
  res.status(201).json({ success: true, department: dept });
});

router.put('/departments/:id', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  const idx = cfg.departments.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Department not found.' });

  // Protect the id; allow updating label, ldapGroup (fields managed separately)
  const { label, ldapGroup } = req.body || {};
  if (label)      cfg.departments[idx].label     = label.trim();
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

// ── Fields (per department) ───────────────────────────────────────────────

router.get('/departments/:id/fields', ...SUPER_ONLY, (req, res) => {
  const dept = readConfig().departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
  res.json({ success: true, fields: dept.fields });
});

router.post('/departments/:id/fields', ...SUPER_ONLY, (req, res) => {
  const { key, label, type, required, options, placeholder } = req.body || {};
  if (!key || !label || !type) {
    return res.status(400).json({ success: false, message: '`key`, `label`, and `type` are required.' });
  }

  const VALID_TYPES = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}.` });
  }

  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
  if (dept.fields.find(f => f.key === key)) {
    return res.status(409).json({ success: false, message: `Field "${key}" already exists in this department.` });
  }

  const field = {
    key:      key.trim(),
    label:    label.trim(),
    type,
    required: !!required,
    ...(type === 'select' && options ? { options: (Array.isArray(options) ? options : options.split(',').map(x => x.trim()).filter(Boolean)) } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  dept.fields.push(field);
  writeConfig(cfg);
  res.status(201).json({ success: true, field });
});

router.put('/departments/:id/fields/:key', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
  const fidx = dept.fields.findIndex(f => f.key === req.params.key);
  if (fidx === -1) return res.status(404).json({ success: false, message: 'Field not found.' });

  const { label, type, required, options, placeholder } = req.body || {};
  const updated = { ...dept.fields[fidx] };
  if (label     !== undefined) updated.label    = label.trim();
  if (type      !== undefined) updated.type     = type;
  if (required  !== undefined) updated.required = !!required;
  if (options   !== undefined) updated.options  = Array.isArray(options) ? options : options.split(',').map(x => x.trim()).filter(Boolean);
  if (placeholder !== undefined) updated.placeholder = placeholder;

  dept.fields[fidx] = updated;
  writeConfig(cfg);
  res.json({ success: true, field: updated });
});

router.delete('/departments/:id/fields/:key', ...SUPER_ONLY, (req, res) => {
  const cfg  = readConfig();
  const dept = cfg.departments.find(d => d.id === req.params.id);
  if (!dept) return res.status(404).json({ success: false, message: 'Department not found.' });
  const before = dept.fields.length;
  dept.fields = dept.fields.filter(f => f.key !== req.params.key);
  if (dept.fields.length === before) {
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

// PUT /admin/role-map  { ldapGroup, role }  — add or update a single entry
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

// DELETE /admin/role-map/:group — remove a mapping
router.delete('/role-map/:group', ...SUPER_ONLY, (req, res) => {
  const cfg = readConfig();
  cfg.roleGroupMap = cfg.roleGroupMap || {};
  delete cfg.roleGroupMap[decodeURIComponent(req.params.group).toLowerCase()];
  writeConfig(cfg);
  res.json({ success: true, roleGroupMap: cfg.roleGroupMap });
});

module.exports = router;
