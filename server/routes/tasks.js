const express           = require('express');
const { db, nextSerial } = require('../db');
const { verifyToken, requireCS, requireStaff } = require('../middleware/authMiddleware');
const { logAudit } = require('../utils/audit');

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
    // Dept staff see: tasks at their dept OR tasks where they were consulted
    where.push(`(
      current_dept_id = ?
      OR id IN (
        SELECT task_id FROM task_events
        WHERE type = 'consultation' AND to_dept = ?
      )
    )`);
    params.push(user.dept_id || '', user.dept_id || '');
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (dept)   { where.push('current_dept_id = ?'); params.push(dept); }
  if (search) {
    where.push('(title LIKE ? OR serial LIKE ? OR source_entity LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Include last return note and last forwarded-to dept for inline display
  const tasks = db.prepare(`
    SELECT tasks.*,
      (SELECT note FROM task_events
       WHERE task_id = tasks.id AND type = 'returned'
       ORDER BY id DESC LIMIT 1) AS last_return_note,
      (SELECT actor_name FROM task_events
       WHERE task_id = tasks.id AND type = 'returned'
       ORDER BY id DESC LIMIT 1) AS returned_by_name
    FROM tasks ${whereClause}
    ORDER BY
      CASE WHEN status = 'returned' THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM tasks ${whereClause}`
  ).get(...params).n;

  // Status counts for tab badges (unfiltered, same visibility scope)
  const countWhere = !canSeeAll(user.role)
    ? `WHERE (current_dept_id = ? OR id IN (SELECT task_id FROM task_events WHERE type='consultation' AND to_dept=?))`
    : '';
  const countParams = !canSeeAll(user.role) ? [user.dept_id || '', user.dept_id || ''] : [];
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as n FROM tasks ${countWhere} GROUP BY status
  `).all(...countParams).reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});

  res.json({ success: true, tasks, total, statusCounts });
});

// POST /tasks/bulk — bulk close or forward
router.post('/bulk', AUTH, requireCS, (req, res) => {
  const { action, task_ids, dept_id, note } = req.body || {};
  if (!action || !Array.isArray(task_ids) || !task_ids.length) {
    return res.status(400).json({ success: false, message: 'action and task_ids[] required.' });
  }
  if (!['close', 'forward'].includes(action)) {
    return res.status(400).json({ success: false, message: 'action must be "close" or "forward".' });
  }
  if (action === 'forward' && !dept_id) {
    return res.status(400).json({ success: false, message: 'dept_id required for forward.' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let processed = 0;

  db.transaction(() => {
    for (const id of task_ids) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!task || task.status === 'closed') continue;

      if (action === 'close') {
        db.prepare('UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id=?')
          .run('closed', now, now, id);
        db.prepare('INSERT INTO task_events (task_id, type, actor_id, actor_name, note) VALUES (?,?,?,?,?)')
          .run(id, 'closed', req.user.id||null, req.user.name||req.user.username, note||'');
      } else {
        const from = task.current_dept_id;
        db.prepare('UPDATE tasks SET current_dept_id=?, status=?, updated_at=? WHERE id=?')
          .run(dept_id, 'assigned', now, id);
        db.prepare('INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note) VALUES (?,?,?,?,?,?,?)')
          .run(id, 'forwarded', from, dept_id, req.user.id||null, req.user.name||req.user.username, note||'');
        db.prepare('INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type) VALUES (?,?,?,?,?)')
          .run(dept_id, id, task.serial, task.title, 'forwarded');
      }
      processed++;
    }
  })();

  res.json({ success: true, processed });
});

// ── GET /tasks/export — download as CSV ──────────────────────
router.get('/export', AUTH, (req, res) => {
  const user = req.user;
  const { status, dept, search } = req.query;

  let where = [];
  let params = [];

  if (!canSeeAll(user.role)) {
    where.push(`(
      current_dept_id = ?
      OR id IN (SELECT task_id FROM task_events WHERE type = 'consultation' AND to_dept = ?)
    )`);
    params.push(user.dept_id || '', user.dept_id || '');
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
    `SELECT * FROM tasks ${whereClause} ORDER BY updated_at DESC`
  ).all(...params);

  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const headers = ['Serial', 'Title', 'Status', 'Priority', 'Type', 'Source', 'Department', 'Expected', 'Completed', 'Created'];
  const rows = tasks.map(t => [
    t.serial,
    escape(t.title),
    t.status,
    t.priority,
    t.type,
    escape(t.source_entity),
    t.current_dept_id || '',
    t.expected_at   ? t.expected_at.slice(0, 10) : '',
    t.completed_at  ? t.completed_at.slice(0, 10) : '',
    t.created_at    ? t.created_at.slice(0, 10) : '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const filename = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM prefix for Excel UTF-8 compatibility
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

// ── POST /tasks — create (any staff or above) ────────────────
router.post('/', AUTH, requireStaff, (req, res) => {
  const {
    title, type = 'incoming', priority = 'normal',
    source_entity, delivery_method, expected_at, extra_data, note,
    target_dept_id,  // CS can set this to immediately route to a department
  } = req.body || {};

  if (!title) return res.status(400).json({ success: false, message: 'title is required.' });

  const serial     = nextSerial();
  const now        = new Date().toISOString();
  const deptId     = target_dept_id || '';
  const initStatus = target_dept_id ? 'assigned' : 'new';

  const info = db.prepare(`
    INSERT INTO tasks
      (serial, title, type, priority, status, source_entity, delivery_method,
       current_dept_id, expected_at, extra_data, created_by_id, created_by_name, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    serial, title.trim(), type, priority,
    initStatus,
    source_entity || '', delivery_method || '',
    deptId,
    expected_at || '', extra_data ? JSON.stringify(extra_data) : null,
    req.user.id || null, req.user.name || req.user.username,
    now,
  );

  const taskId = info.lastInsertRowid;

  db.prepare(`
    INSERT INTO task_events (task_id, type, actor_id, actor_name, note)
    VALUES (?, 'created', ?, ?, ?)
  `).run(taskId, req.user.id || null, req.user.name || req.user.username, note || '');

  if (target_dept_id) {
    db.prepare(`
      INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note)
      VALUES (?, 'forwarded', '', ?, ?, ?, ?)
    `).run(taskId, target_dept_id, req.user.id || null, req.user.name || req.user.username, note || '');

    const taskRow = db.prepare('SELECT serial, title FROM tasks WHERE id = ?').get(taskId);
    db.prepare('INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type) VALUES (?,?,?,?,?)')
      .run(target_dept_id, taskId, taskRow.serial, taskRow.title, 'forwarded');
  }

  const task = withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  logAudit(req.user, 'TASK_CREATED', 'task', taskId, { serial: task.serial }, req.ip);
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

  const fromDept = task.current_dept_id || 'reception_dept';

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

  logAudit(req.user, 'TASK_FORWARDED', 'task', req.params.id, { to: to_dept_id }, req.ip);
  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/accept — dept accepts (in_progress) ──────
router.post('/:id/accept', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  if (task.status === 'closed') {
    return res.status(400).json({ success: false, message: 'Task is already closed.' });
  }
  if (task.status === 'in_progress') {
    return res.status(400).json({ success: false, message: 'Task is already in progress.' });
  }

  // Only the dept the task is currently at may accept it
  const user = req.user;
  const isCS = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user.role);
  if (!isCS && task.current_dept_id !== (user.dept_id || '')) {
    return res.status(403).json({ success: false, message: 'This task is not assigned to your department.' });
  }

  db.prepare(`
    UPDATE tasks SET status = 'in_progress', updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(task.id);

  db.prepare(`
    INSERT INTO task_events (task_id, type, actor_id, actor_name, note)
    VALUES (?, 'accepted', ?, ?, ?)
  `).run(task.id, user.id || null, user.name || user.username, '');

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/return — dept returns to CS ───────────────
router.post('/:id/return', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  if (task.status === 'closed') {
    return res.status(400).json({ success: false, message: 'Task is already closed.' });
  }

  // Non-CS users may only return tasks that are currently at their own department
  const user = req.user;
  const isCS = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user.role);
  if (!isCS && task.current_dept_id !== (user.dept_id || '')) {
    return res.status(403).json({ success: false, message: 'This task is not assigned to your department.' });
  }

  const { note } = req.body || {};
  const fromDept = task.current_dept_id || '';

  db.prepare(`
    UPDATE tasks SET current_dept_id = '', status = 'returned', updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(task.id);

  db.prepare(`
    INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note)
    VALUES (?, 'returned', ?, 'reception_dept', ?, ?, ?)
  `).run(task.id, fromDept, user.id || null, user.name || user.username, note || '');

  // Notify reception
  db.prepare(`
    INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type)
    VALUES ('reception_dept', ?, ?, ?, 'returned')
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

  logAudit(req.user, 'TASK_CLOSED', 'task', req.params.id, null, req.ip);
  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

// ── POST /tasks/:id/comment ───────────────────────────────────
// Pass tagged_dept_id to create a consultation comment (inter-dept message)
router.post('/:id/comment', AUTH, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  const { note, tagged_dept_id } = req.body || {};
  if (!note?.trim()) return res.status(400).json({ success: false, message: 'note is required.' });

  const user     = req.user;
  const fromDept = user.dept_id || 'reception_dept';
  const isConsultation = !!tagged_dept_id;

  db.prepare(`
    INSERT INTO task_events (task_id, type, from_dept, to_dept, actor_id, actor_name, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    isConsultation ? 'consultation' : 'commented',
    isConsultation ? fromDept : null,
    isConsultation ? tagged_dept_id : null,
    user.id || null,
    user.name || user.username,
    note.trim(),
  );

  if (isConsultation) {
    db.prepare(`
      INSERT INTO notifications (dept_id, task_id, task_serial, task_title, type)
      VALUES (?, ?, ?, ?, 'consultation')
    `).run(tagged_dept_id, task.id, task.serial, task.title);
  }

  res.json({ success: true, task: withEvents(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)) });
});

module.exports = router;
