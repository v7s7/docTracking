const express = require('express');
const { db }  = require('../db');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const router   = express.Router();
const AUTH     = verifyToken;
const MGMT     = [verifyToken, requireRole('ADMIN')];

router.get('/', AUTH, (req, res) => {
  const templates = db.prepare('SELECT * FROM task_templates ORDER BY name ASC').all();
  res.json({ success: true, templates });
});

router.post('/', ...MGMT, (req, res) => {
  const { name, type, priority, source_entity, delivery_method, expected_days, note } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'name is required.' });
  const info = db.prepare(
    'INSERT INTO task_templates (name, type, priority, source_entity, delivery_method, expected_days, note, created_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(name.trim(), type||'incoming', priority||'normal', source_entity||'', delivery_method||'', expected_days||null, note||'', req.user.username);
  res.status(201).json({ success: true, template: db.prepare('SELECT * FROM task_templates WHERE id=?').get(info.lastInsertRowid) });
});

router.put('/:id', ...MGMT, (req, res) => {
  const tpl = db.prepare('SELECT * FROM task_templates WHERE id=?').get(req.params.id);
  if (!tpl) return res.status(404).json({ success: false, message: 'Template not found.' });
  const { name, type, priority, source_entity, delivery_method, expected_days, note } = req.body || {};
  db.prepare('UPDATE task_templates SET name=?,type=?,priority=?,source_entity=?,delivery_method=?,expected_days=?,note=? WHERE id=?')
    .run(name??tpl.name, type??tpl.type, priority??tpl.priority, source_entity??tpl.source_entity, delivery_method??tpl.delivery_method, expected_days??tpl.expected_days, note??tpl.note, tpl.id);
  res.json({ success: true, template: db.prepare('SELECT * FROM task_templates WHERE id=?').get(tpl.id) });
});

router.delete('/:id', ...MGMT, (req, res) => {
  const info = db.prepare('DELETE FROM task_templates WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ success: false, message: 'Template not found.' });
  res.json({ success: true });
});

module.exports = router;
