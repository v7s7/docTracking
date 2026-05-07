const express           = require('express');
const { db, nextSerial } = require('../db');
const { verifyToken, requireCS } = require('../middleware/authMiddleware');

const router = express.Router();
const AUTH   = verifyToken;

// ── Visibility helper ────────────────────────────────────────
// SUPER_ADMIN / ADMIN / CUSTOMER_SERVICE: see all tasks
// STAFF / MANAGER / READONLY: see only tasks in their dept
function canSeeAll(role) {
  return ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role);
}

function withEvents(task) {
  if (!task) return null;
  const events = db.prepare(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC'
  ).all(task.id);
  return { ...task, events };
}

// ── GET /tasks ───────────────────────────────────────────────
router.get('/', AUTH, (req, res) => {
  const { status, dept, search, limit = 50, offset = 0 } = req.query;
  const user = req.user;

  let where = [];
  let params = [];

  if (!canSeeAll(user.role)) {
    where.push('current_dept_id = ?');
    params.push(user.dept_id || '');
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (dept)   { where.push('current_dept_id = ?'); params.push(dept); }
  if (search) {
    where.push('(title LIKE ? OR serial LIKE ? OR source_entity LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const tasks = db.prepare(
    `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), Number(offset));

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM tasks ${whereClause}`
  ).get(...params).n;

  res.json({ success: true, tasks, total });
});

// ── GET /tasks/:id ───────────────────────────────────────────
router.get('/:id', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  const user = req.user;
  if (!canSeeAll(user.role) && task.current_dept_id !== (user.dept_id || '')) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  res.json({ success: true, task: withEvents(task) });
});

// ── POST /tasks — create (CS or above) ───────────────────────
router.post('/', AUTH, requireCS, (req, res) => {
  const {
    title, type = 'incoming', priority = 'normal',
    source_entity, delivery_method, expected_at, extra_data, note,
  } = req.body || {};

  if (!title) return res.status(400).json({ success: false, message: 'title is required.' });

  const serial = nextSerial();
  const now    = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO tasks
      (serial, title, type, priority, status, source_entity, delivery_method,
       current_dept_id, expected_at, extra_data, created_by_id, created_by_name, updated_at)
    VALUES (?,?,?,?,'new',?,?,?,?,?,?,?,?)
  `).run(
    serial, title.trim(), type, priority,
    source_entity || '', delivery_method || '',
    '',                   // starts unassigned (at CS)
    expected_at || '', extra_data ? JSON.stringify(extra_data) : null,
    req.user.id || null, req.user.name || req.user.username,
    now,
  );

  db.prepare(`
    INSERT INTO task_events (task_id, type, actor_id, actor_name, note)
    VALUES (?, 'created', ?, ?, ?)
  `).run(info.lastInsertRowid, req.user.id || null, req.user.name || req.user.username, note || '');

  const task = withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
  res.status(201).json({ success: true, task });
});

// ── PUT /tasks/:id — update fields ───────────────────────────
router.put('/:id', AUTH, requireCS, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  const allowed = ['title', 'type', 'priority', 'source_entity', 'delivery_method', 'expected_at', 'extra_data'];
  const sets = []; const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(k === 'extra_data' ? JSON.stringify(req.body[k]) : req.body[k]);
    }
  }
  if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update.' });

  sets.push("updated_at = datetime('now','localtime')");
  params.push(task.id);

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/forward — send to a dept ─────────────────
router.post('/:id/forward', AUTH, requireCS, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  if (task.status === 'closed') {
    return res.status(400).json({ success: false, message: 'Cannot forward a closed task.' });
  }

  const { to_dept_id, note } = req.body || {};
  if (!to_dept_id) return res.status(400).json({ success: false, message: 'to_dept_id is required.' });

  const fromDept = task.current_dept_id || 'customer_service';

  db.prepare(`
    UPDATE tasks SET current_dept_id = ?, status = 'assigned', updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(to_dept_id, task.id);

  db.prepare(`
    INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note)
    VALUES (?, 'forwarded', ?, ?, ?, ?, ?)
  `).run(task.id, fromDept, to_dept_id, req.user.id || null, req.user.name || req.user.username, note || '');

  // Notify the destination department
  db.prepare(`
    INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type)
    VALUES (?, ?, ?, ?, 'forwarded')
  `).run(to_dept_id, task.id, task.serial, task.title);

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/return — dept returns to CS ───────────────
router.post('/:id/return', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  if (task.status === 'closed') {
    return res.status(400).json({ success: false, message: 'Task is already closed.' });
  }

  const { note } = req.body || {};
  const fromDept = task.current_dept_id || '';

  db.prepare(`
    UPDATE tasks SET current_dept_id = '', status = 'returned', updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(task.id);

  db.prepare(`
    INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note)
    VALUES (?, 'returned', ?, 'customer_service', ?, ?, ?)
  `).run(task.id, fromDept, req.user.id || null, req.user.name || req.user.username, note || '');

  // Notify CS that the task was returned
  db.prepare(`
    INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type)
    VALUES ('customer_service', ?, ?, ?, 'returned')
  `).run(task.id, task.serial, task.title);

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/close ─────────────────────────────────────
router.post('/:id/close', AUTH, requireCS, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  if (task.status === 'closed') {
    return res.status(400).json({ success: false, message: 'Already closed.' });
  }

  const { note } = req.body || {};
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE tasks SET status = 'closed', completed_at = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(now, task.id);

  db.prepare(`
    INSERT INTO task_events (task_id, type, actor_id, actor_name, note)
    VALUES (?, 'closed', ?, ?, ?)
  `).run(task.id, req.user.id || null, req.user.name || req.user.username, note || '');

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/comment ───────────────────────────────────
router.post('/:id/comment', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  const { note } = req.body || {};
  if (!note?.trim()) return res.status(400).json({ success: false, message: 'note is required.' });

  db.prepare(`
    INSERT INTO task_events (task_id, type, actor_id, actor_name, note)
    VALUES (?, 'commented', ?, ?, ?)
  `).run(task.id, req.user.id || null, req.user.name || req.user.username, note.trim());

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

module.exports = router;
