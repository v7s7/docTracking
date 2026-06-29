// server/routes/personalTasks.js
// A user's own to-do list. Separate from the dept-routed `tasks` table —
// no department, no routing, no role gate beyond being logged in. Every
// route is scoped to req.user.id so nobody can see or touch anyone else's.
const express = require('express');
const { db }  = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

const TITLE_MAX = 300;

function validateTitle(raw) {
  const title = String(raw || '').trim();
  if (!title) return { error: 'Title is required.' };
  if (title.length > TITLE_MAX) return { error: `Title must be ${TITLE_MAX} characters or fewer.` };
  return { title };
}

function validateDueAt(raw) {
  if (!raw) return { dueAt: null };
  if (Number.isNaN(new Date(raw).getTime())) return { error: 'Invalid due date.' };
  return { dueAt: raw };
}

// GET /personal-tasks — mine only: open first (soonest due date, then no
// due date, then newest), completed ones last.
router.get('/', verifyToken, (req, res) => {
  const items = db.prepare(`
    SELECT * FROM personal_tasks WHERE user_id = ?
    ORDER BY done ASC,
             CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END ASC,
             due_at ASC,
             created_at DESC
  `).all(req.user.id);
  res.json({ success: true, items });
});

// POST /personal-tasks — create
router.post('/', verifyToken, (req, res) => {
  const { title, error: titleErr } = validateTitle(req.body?.title);
  if (titleErr) return res.status(400).json({ success: false, message: titleErr });

  const { dueAt, error: dueErr } = validateDueAt(req.body?.due_at);
  if (dueErr) return res.status(400).json({ success: false, message: dueErr });

  const result = db.prepare(
    "INSERT INTO personal_tasks (user_id, title, due_at) VALUES (?, ?, ?)"
  ).run(req.user.id, title, dueAt);

  const item = db.prepare("SELECT * FROM personal_tasks WHERE id = ?").get(result.lastInsertRowid);
  res.json({ success: true, item });
});

// PUT /personal-tasks/:id — update title / due_at / done (own items only)
router.put('/:id', verifyToken, (req, res) => {
  const existing = db.prepare("SELECT * FROM personal_tasks WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Not found.' });

  const { title, error: titleErr } = validateTitle(req.body?.title !== undefined ? req.body.title : existing.title);
  if (titleErr) return res.status(400).json({ success: false, message: titleErr });

  const { dueAt, error: dueErr } = validateDueAt(req.body?.due_at !== undefined ? req.body.due_at : existing.due_at);
  if (dueErr) return res.status(400).json({ success: false, message: dueErr });

  const done = req.body?.done !== undefined ? (req.body.done ? 1 : 0) : existing.done;

  // completed_at: stamp it the moment done flips 0 -> 1, clear it on reopen,
  // leave it alone if it was already done and stays done.
  let completedAtSql = 'NULL';
  if (done && !existing.done) completedAtSql = "datetime('now','localtime')";
  else if (done) completedAtSql = 'completed_at';

  db.prepare(`
    UPDATE personal_tasks
    SET title = ?, due_at = ?, done = ?, completed_at = ${completedAtSql}, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(title, dueAt, done, existing.id);

  const item = db.prepare("SELECT * FROM personal_tasks WHERE id = ?").get(existing.id);
  res.json({ success: true, item });
});

// DELETE /personal-tasks/:id — own items only
router.delete('/:id', verifyToken, (req, res) => {
  const result = db.prepare("DELETE FROM personal_tasks WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ success: false, message: 'Not found.' });
  res.json({ success: true });
});

module.exports = router;
