// server/routes/correspondence.js — نظام المراسلات الداخلية
//
// Workflow contract (see claude/correspondence-merge-plan.md):
//   employee creates            → pending
//   own department head approves→ approved   → visible to the receiving department
//   receiving department        → done
//   head rejects (reason forced)→ returned   → back to the author
//   author edits and resubmits  → pending    (same id, same serial, timeline grows)
//
// Every read — list, detail, badge counts — goes through the SAME visibility
// clause in utils/approvals.js, so a record can never show up in a list the
// caller is then refused when they open it.
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { db }          = require('../db');
const { verifyToken, requireStaff } = require('../middleware/authMiddleware');
const { logAudit }    = require('../utils/audit');
const { readConfig }  = require('../services/configService');
const { resolveSubject, OTHER_SERVICE_ID } = require('../utils/serviceScope');
const {
  isAdmin, canApproveFor, myDepartments, visibilityClause, approversOf,
} = require('../utils/approvals');
const notify = require('../services/correspondenceNotify');
const chat   = require('../services/chatBridge');

const router = express.Router();
const AUTH   = verifyToken;

// ── File storage ──────────────────────────────────────────────────────────
// Deliberately NOT under data/uploads: index.js serves that directory as
// unauthenticated static files. Official correspondence attachments are served
// only through the authorised download route below.
const UPLOAD_DIR  = path.join(__dirname, '..', 'data', 'correspondence-files');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES   = 10 * 1024 * 1024;               // 10MB, per the build brief
const BLOCKED_EXT = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.scr', '.ps1'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (BLOCKED_EXT.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('BLOCKED_TYPE'));
    }
    cb(null, true);
  },
}).array('attachments', 10);

// Wraps multer so its errors come back as clean Arabic JSON instead of a 500.
function withUploads(req, res, next) {
  upload(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'حجم الملف أكبر من 10MB.' });
    }
    if (err.message === 'BLOCKED_TYPE') {
      return res.status(400).json({ success: false, message: 'نوع الملف غير مسموح به.' });
    }
    return res.status(400).json({ success: false, message: 'تعذر رفع المرفقات.' });
  });
}

// Remove files already written to disk when the request is rejected afterwards.
function discardUploads(req) {
  for (const f of req.files || []) {
    try { fs.unlinkSync(f.path); } catch { /* already gone */ }
  }
}

function fail(req, res, code, message) {
  discardUploads(req);
  return res.status(code).json({ success: false, message });
}

// ── Helpers ───────────────────────────────────────────────────────────────
const PRIORITIES = ['high', 'med', 'low'];

const deptLabel = id =>
  (readConfig().departments || []).find(d => d.id === id)?.label || id || '';

const serialFor = id => `MSG-${String(id).padStart(4, '0')}`;

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    from_dept_label: deptLabel(row.from_dept_id),
    to_dept_label:   deptLabel(row.to_dept_id),
    events: db.prepare(
      // id as the tiebreaker: created_at has 1-second resolution, and a create
      // followed immediately by an approve would otherwise order at random.
      'SELECT * FROM correspondence_events WHERE correspondence_id = ? ORDER BY created_at ASC, id ASC'
    ).all(row.id),
    attachments: db.prepare(
      'SELECT id, file_name, file_type, file_size FROM correspondence_attachments WHERE correspondence_id = ? ORDER BY id'
    ).all(row.id),
  };
}

function addEvent(id, type, user, note = null, isReject = 0) {
  db.prepare(`
    INSERT INTO correspondence_events (correspondence_id, type, actor_id, actor_name, note, is_reject)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, type, user.id || null, user.name || user.username, note, isReject);
}

// Loads a record and enforces read access with the shared clause.
function loadVisible(req, res) {
  const row = db.prepare('SELECT * FROM correspondences WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ success: false, message: 'المراسلة غير موجودة.' });
    return null;
  }
  const { clause, params } = visibilityClause(req.user);
  if (clause) {
    const ok = db.prepare(`SELECT 1 FROM correspondences c WHERE c.id = ? AND ${clause}`)
                 .get(row.id, ...params);
    if (!ok) {
      res.status(403).json({ success: false, message: 'لا تملك صلاحية الاطلاع على هذه المراسلة.' });
      return null;
    }
  }
  return row;
}

// ── GET / — list ──────────────────────────────────────────────────────────
// box: inbox | approvals | returned | archive (default archive = all visible)
router.get('/', AUTH, (req, res) => {
  const user = req.user;
  const { box = 'archive', status, search, limit = 100, offset = 0 } = req.query;

  const where = [];
  const params = [];
  const mine = myDepartments(user);
  const inMine = mine.length ? mine.map(() => '?').join(',') : null;

  if (box === 'inbox') {
    if (!inMine) return res.json({ success: true, items: [], total: 0 });
    where.push(`c.to_dept_id IN (${inMine})`, `c.status IN ('approved','done')`);
    params.push(...mine);
  } else if (box === 'approvals') {
    const approvable = isAdmin(user)
      ? (readConfig().departments || []).map(d => d.id)
      : (readConfig().departments || []).map(d => d.id).filter(id => canApproveFor(user, id));
    if (!approvable.length) return res.json({ success: true, items: [], total: 0 });
    where.push(`c.status = 'pending'`, `c.from_dept_id IN (${approvable.map(() => '?').join(',')})`);
    params.push(...approvable);
  } else if (box === 'returned') {
    where.push(`c.status = 'returned'`, 'c.from_user_id = ?');
    params.push(user.id ?? -1);
  } else {
    const v = visibilityClause(user);
    if (v.clause) { where.push(v.clause); params.push(...v.params); }
  }

  if (status) { where.push('c.status = ?'); params.push(status); }
  if (search) {
    where.push('(c.subject LIKE ? OR c.serial LIKE ? OR c.from_dept_id LIKE ? OR c.to_dept_id LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const sql = `FROM correspondences c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...params).n;
  const rows  = db.prepare(
    `SELECT c.* ${sql} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`
  ).all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0);

  res.json({
    success: true,
    total,
    items: rows.map(r => ({
      ...r,
      from_dept_label: deptLabel(r.from_dept_id),
      to_dept_label:   deptLabel(r.to_dept_id),
    })),
  });
});

// ── GET /stats — dashboard tiles + sidebar badges ─────────────────────────
router.get('/stats', AUTH, (req, res) => {
  const user = req.user;
  const { clause, params } = visibilityClause(user);
  const scope = clause ? `WHERE ${clause}` : '';

  const byStatus = {};
  for (const r of db.prepare(
    `SELECT c.status, COUNT(*) n FROM correspondences c ${scope} GROUP BY c.status`
  ).all(...params)) byStatus[r.status] = r.n;

  const mine   = myDepartments(user);
  const inMine = mine.length ? mine.map(() => '?').join(',') : null;

  const approvable = (readConfig().departments || []).map(d => d.id).filter(id => canApproveFor(user, id));

  const inboxBadge = inMine
    ? db.prepare(`SELECT COUNT(*) n FROM correspondences WHERE to_dept_id IN (${inMine}) AND status = 'approved'`).get(...mine).n
    : 0;
  const approvalsBadge = approvable.length
    ? db.prepare(`SELECT COUNT(*) n FROM correspondences WHERE status = 'pending' AND from_dept_id IN (${approvable.map(() => '?').join(',')})`).get(...approvable).n
    : 0;
  const returnedBadge = db.prepare(
    `SELECT COUNT(*) n FROM correspondences WHERE status = 'returned' AND from_user_id = ?`
  ).get(user.id ?? -1).n;

  res.json({
    success: true,
    stats: {
      total:    Object.values(byStatus).reduce((s, n) => s + n, 0),
      pending:  byStatus.pending  || 0,   // بانتظار الموافقة
      approved: byStatus.approved || 0,   // جارية التنفيذ
      done:     byStatus.done     || 0,   // تم الإنجاز
      returned: byStatus.returned || 0,   // مُعادة للمراجعة
    },
    badges: { inbox: inboxBadge, approvals: approvalsBadge, returned: returnedBadge },
    canApproveFor: approvable,
  });
});

// ── GET /notifications — for the header bell ──────────────────────────────
router.get('/notifications', AUTH, (req, res) => {
  const uid = req.user?.id;
  if (!uid) return res.json({ success: true, unread: 0, items: [] });
  const unread = db.prepare(
    'SELECT COUNT(*) n FROM correspondence_notifications WHERE user_id = ? AND is_read = 0'
  ).get(uid).n;
  const items = db.prepare(
    'SELECT * FROM correspondence_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20'
  ).all(uid);
  res.json({ success: true, unread, items });
});

router.post('/notifications/read', AUTH, (req, res) => {
  if (req.user?.id) {
    db.prepare('UPDATE correspondence_notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  }
  res.json({ success: true });
});


// ── GET /reports — statistics ─────────────────────────────────────────────
// Scoped by the same visibility clause as everything else, so a department head
// sees their own departments' numbers and مدير النظام sees the organisation.
// Timestamps are 'YYYY-MM-DD HH:MM:SS' localtime, which julianday() reads
// directly — the difference is in days, hence the *24.
router.get('/reports', AUTH, (req, res) => {
  const user = req.user;
  const { from, to } = req.query;

  const { clause, params } = visibilityClause(user);
  const where = [];
  const p = [];
  if (clause) { where.push(clause); p.push(...params); }
  if (from)   { where.push('c.created_at >= ?'); p.push(`${from} 00:00:00`); }
  if (to)     { where.push('c.created_at <= ?'); p.push(`${to} 23:59:59`); }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const labels = Object.fromEntries((readConfig().departments || []).map(d => [d.id, d.label]));
  const serviceLabels = {};
  for (const d of readConfig().departments || []) {
    for (const sv of d.services || []) serviceLabels[sv.id] = sv.label;
  }

  const byStatus = {};
  for (const r of db.prepare(`SELECT c.status, COUNT(*) n FROM correspondences c ${W} GROUP BY c.status`).all(...p)) {
    byStatus[r.status] = r.n;
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // A memo counts as rejected once if it was ever returned, however many times.
  const everRejected = db.prepare(`
    SELECT COUNT(DISTINCT c.id) n FROM correspondences c ${W}
    ${W ? 'AND' : 'WHERE'} EXISTS (SELECT 1 FROM correspondence_events e
                                    WHERE e.correspondence_id = c.id AND e.is_reject = 1)
  `).get(...p).n;

  const timing = db.prepare(`
    SELECT
      AVG(CASE WHEN c.approved_at  IS NOT NULL THEN (julianday(c.approved_at)  - julianday(c.created_at))  * 24 END) approve_h,
      AVG(CASE WHEN c.completed_at IS NOT NULL THEN (julianday(c.completed_at) - julianday(c.approved_at)) * 24 END) complete_h
    FROM correspondences c ${W}
  `).get(...p);

  const byMonth = db.prepare(`
    SELECT substr(c.created_at, 1, 7) month, COUNT(*) n
      FROM correspondences c ${W}
     GROUP BY month ORDER BY month
  `).all(...p);

  const sent = db.prepare(`SELECT c.from_dept_id id, COUNT(*) n FROM correspondences c ${W} GROUP BY c.from_dept_id`).all(...p);
  const recv = db.prepare(`SELECT c.to_dept_id   id, COUNT(*) n FROM correspondences c ${W} GROUP BY c.to_dept_id`).all(...p);
  const deptMap = new Map();
  const bump = (id, key, n) => {
    if (!deptMap.has(id)) deptMap.set(id, { id, label: labels[id] || id, sent: 0, received: 0 });
    deptMap.get(id)[key] += n;
  };
  sent.forEach(r => bump(r.id, 'sent', r.n));
  recv.forEach(r => bump(r.id, 'received', r.n));
  const byDepartment = [...deptMap.values()]
    .map(d => ({ ...d, total: d.sent + d.received }))
    .sort((a, b) => b.total - a.total);

  const byService = db.prepare(`
    SELECT c.service_id id, COUNT(*) n FROM correspondences c ${W}
     GROUP BY c.service_id ORDER BY n DESC
  `).all(...p).map(r => ({
    id: r.id,
    label: r.id === 'other' ? null : (serviceLabels[r.id] || r.id),
    count: r.n,
  }));

  // Oldest first — the backlog is read from the top.
  const backlog = db.prepare(`
    SELECT c.id, c.serial, c.subject, c.from_dept_id, c.from_user_name, c.created_at,
           CAST(julianday('now','localtime') - julianday(c.created_at) AS INTEGER) days
      FROM correspondences c
     ${W ? W + " AND" : "WHERE"} c.status = 'pending'
     ORDER BY c.created_at ASC LIMIT 15
  `).all(...p).map(r => ({ ...r, from_dept_label: labels[r.from_dept_id] || r.from_dept_id }));

  const approvers = db.prepare(`
    SELECT e.actor_name name, COUNT(*) n,
           AVG((julianday(e.created_at) - julianday(c.created_at)) * 24) avg_h
      FROM correspondence_events e
      JOIN correspondences c ON c.id = e.correspondence_id
     ${W ? W + " AND" : "WHERE"} e.type IN ('approved','rejected')
     GROUP BY e.actor_name ORDER BY n DESC LIMIT 10
  `).all(...p);

  res.json({
    success: true,
    range: { from: from || null, to: to || null },
    summary: {
      total,
      pending:  byStatus.pending  || 0,
      approved: byStatus.approved || 0,
      done:     byStatus.done     || 0,
      returned: byStatus.returned || 0,
      rejectionRate: total ? Math.round((everRejected / total) * 100) : 0,
      avgApprovalHours:   timing?.approve_h  != null ? Math.round(timing.approve_h  * 10) / 10 : null,
      avgCompletionHours: timing?.complete_h != null ? Math.round(timing.complete_h * 10) / 10 : null,
    },
    byMonth, byDepartment, byService, backlog,
    approvers: approvers.map(a => ({ ...a, avg_h: a.avg_h != null ? Math.round(a.avg_h * 10) / 10 : null })),
  });
});


// ── GET /export — the archive as a spreadsheet ────────────────────────────
// CSV with a UTF-8 BOM so Excel opens the Arabic correctly, and every field
// escaped — including a guard against a leading =, +, - or @, which Excel would
// otherwise execute as a formula.
router.get('/export', AUTH, (req, res) => {
  const { clause, params } = visibilityClause(req.user);
  const where = [];
  const p = [];
  if (clause) { where.push(clause); p.push(...params); }
  if (req.query.from)   { where.push('c.created_at >= ?'); p.push(`${req.query.from} 00:00:00`); }
  if (req.query.to)     { where.push('c.created_at <= ?'); p.push(`${req.query.to} 23:59:59`); }
  if (req.query.status) { where.push('c.status = ?');      p.push(req.query.status); }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`SELECT c.* FROM correspondences c ${W} ORDER BY c.id`).all(...p);
  const AR_STATUS   = { pending: 'بانتظار الموافقة', approved: 'موافق عليها', done: 'تم الإنجاز', returned: 'مُعادة للمراجعة' };
  const AR_PRIORITY = { high: 'عالية', med: 'متوسطة', low: 'منخفضة' };

  const cell = v => {
    const str = String(v ?? '');
    // Excel treats a leading =, +, - or @ as a formula — prefix a quote.
    const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const headers = ['رقم المراسلة','الموضوع','المرسِل','القسم المرسِل','القسم المستلم',
                   'الأولوية','الحالة','تاريخ الإنشاء','تاريخ الموافقة','تمت الموافقة بواسطة',
                   'تاريخ الإنجاز','سبب الإعادة'];
  const body = rows.map(c => [
    c.serial, c.subject, c.from_user_name,
    deptLabel(c.from_dept_id), deptLabel(c.to_dept_id),
    AR_PRIORITY[c.priority] || c.priority, AR_STATUS[c.status] || c.status,
    (c.created_at || '').slice(0, 16), (c.approved_at || '').slice(0, 16),
    c.approved_by_name || '', (c.completed_at || '').slice(0, 16), c.rejection_reason || '',
  ].map(cell).join(','));

  const csv = [headers.map(cell).join(','), ...body].join('\r\n');
  const name = `correspondence-${new Date().toISOString().slice(0, 10)}.csv`;
  logAudit(req.user, 'CORRESPONDENCE_EXPORTED', 'correspondence', null, { count: rows.length }, req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('\ufeff' + csv);
});

// ── GET /:id ──────────────────────────────────────────────────────────────
router.get('/:id', AUTH, (req, res) => {
  const row = loadVisible(req, res);
  if (!row) return;
  res.json({ success: true, item: hydrate(row) });
});

// ── GET /:id/attachments/:attId — authorised download ─────────────────────
router.get('/:id/attachments/:attId', AUTH, (req, res) => {
  const row = loadVisible(req, res);
  if (!row) return;
  const att = db.prepare(
    'SELECT * FROM correspondence_attachments WHERE id = ? AND correspondence_id = ?'
  ).get(req.params.attId, row.id);
  if (!att) return res.status(404).json({ success: false, message: 'المرفق غير موجود.' });

  const full = path.join(UPLOAD_DIR, path.basename(att.stored_name));
  if (!fs.existsSync(full)) {
    return res.status(410).json({ success: false, message: 'الملف لم يعد موجوداً على الخادم.' });
  }
  res.download(full, att.file_name);
});

// ── POST / — create ───────────────────────────────────────────────────────
router.post('/', AUTH, requireStaff, withUploads, (req, res) => {
  const user = req.user;
  const fromDeptId = user.dept_id || '';
  if (!fromDeptId) {
    return fail(req, res, 400, 'لا يوجد قسم مُسند لحسابك. يرجى مراجعة مدير النظام.');
  }

  const { to_dept_id, service_id, subject: custom, body, priority = 'med' } = req.body || {};

  const resolved = resolveSubject({
    fromDeptId, toDeptId: to_dept_id, serviceId: service_id, customSubject: custom,
  });
  if (resolved.error)                 return fail(req, res, 400, resolved.error);
  if (!String(body || '').trim())     return fail(req, res, 400, 'نص المراسلة مطلوب.');
  if (!PRIORITIES.includes(priority)) return fail(req, res, 400, 'الأولوية غير صحيحة.');

  // One transaction: insert, stamp the serial from the row id (so two
  // simultaneous creates can never compute the same number), attach files.
  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO correspondences
        (subject, body, service_id, from_user_id, from_user_name, from_dept_id, to_dept_id, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      resolved.subject, String(body).trim(), resolved.serviceId,
      user.id || null, user.name || user.username, fromDeptId, to_dept_id, priority,
    );
    const id = info.lastInsertRowid;
    db.prepare('UPDATE correspondences SET serial = ? WHERE id = ?').run(serialFor(id), id);

    for (const f of req.files || []) {
      db.prepare(`
        INSERT INTO correspondence_attachments (correspondence_id, stored_name, file_name, file_type, file_size)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, f.filename, f.originalname, f.mimetype, f.size);
    }
    addEvent(id, 'created', user, null, 0);
    return id;
  });

  let id;
  try { id = create(); }
  catch (e) {
    discardUploads(req);
    console.error('[Correspondence] create failed:', e.message);
    return res.status(500).json({ success: false, message: 'تعذر إنشاء المراسلة.' });
  }

  logAudit(user, 'CORRESPONDENCE_CREATED', 'correspondence', id,
    { to_dept_id, service_id: resolved.serviceId, priority }, req.ip);
  const created = hydrate(db.prepare('SELECT * FROM correspondences WHERE id = ?').get(id));
  notify.onSubmitted(created);
  res.status(201).json({ success: true, item: created });
});

// ── PUT /:id — edit a returned memo and resubmit ──────────────────────────
router.put('/:id', AUTH, withUploads, (req, res) => {
  const user = req.user;
  const row  = db.prepare('SELECT * FROM correspondences WHERE id = ?').get(req.params.id);
  if (!row)                          return fail(req, res, 404, 'المراسلة غير موجودة.');
  if (row.from_user_id !== user.id)  return fail(req, res, 403, 'يمكن لصاحب المراسلة فقط تعديلها.');
  if (row.status !== 'returned')     return fail(req, res, 400, 'لا يمكن التعديل إلا على المراسلات المُعادة.');

  const { to_dept_id, service_id, subject: custom, body, priority } = req.body || {};
  const toDept = to_dept_id || row.to_dept_id;

  const resolved = resolveSubject({
    fromDeptId: row.from_dept_id, toDeptId: toDept, serviceId: service_id, customSubject: custom,
  });
  if (resolved.error)               return fail(req, res, 400, resolved.error);
  if (!String(body || '').trim())   return fail(req, res, 400, 'نص المراسلة مطلوب.');
  const prio = priority || row.priority;
  if (!PRIORITIES.includes(prio))   return fail(req, res, 400, 'الأولوية غير صحيحة.');

  const resubmit = db.transaction(() => {
    db.prepare(`
      UPDATE correspondences
         SET subject = ?, body = ?, service_id = ?, to_dept_id = ?, priority = ?,
             status = 'pending', rejection_reason = NULL,
             updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(resolved.subject, String(body).trim(), resolved.serviceId, toDept, prio, row.id);

    for (const f of req.files || []) {
      db.prepare(`
        INSERT INTO correspondence_attachments (correspondence_id, stored_name, file_name, file_type, file_size)
        VALUES (?, ?, ?, ?, ?)
      `).run(row.id, f.filename, f.originalname, f.mimetype, f.size);
    }
    addEvent(row.id, 'resubmitted', user, null, 0);
  });

  try { resubmit(); }
  catch (e) {
    discardUploads(req);
    console.error('[Correspondence] resubmit failed:', e.message);
    return res.status(500).json({ success: false, message: 'تعذر إعادة إرسال المراسلة.' });
  }

  logAudit(user, 'CORRESPONDENCE_RESUBMITTED', 'correspondence', row.id, null, req.ip);
  const resent = hydrate(db.prepare('SELECT * FROM correspondences WHERE id = ?').get(row.id));
  notify.onSubmitted(resent);
  res.json({ success: true, item: resent });
});

// ── POST /:id/discuss — open a chat about this memo ───────────────────────
// A rejection reason is one-way: the employee reads "يرجى إرفاق كتاب المسجد"
// and has nowhere to answer. This opens the direct conversation between the
// two people the memo is actually between, seeded with its reference.
router.post('/:id/discuss', AUTH, (req, res) => {
  const row = loadVisible(req, res);
  if (!row) return;

  const me = req.user?.id;
  if (!me) return res.status(403).json({ success: false, message: 'حسابك غير مكتمل الإعداد.' });

  // Talking to the author unless you ARE the author — then to whoever can
  // approve for your department, preferring someone with an actual account.
  let otherId = null;
  if (row.from_user_id !== me) {
    otherId = row.from_user_id;
  } else {
    const names = approversOf(row.from_dept_id);
    const cand = names.length
      ? db.prepare(`SELECT id FROM users WHERE is_active = 1 AND username IN (${names.map(() => '?').join(',')}) LIMIT 1`).get(...names)
      : null;
    otherId = cand?.id || db.prepare(
      `SELECT id FROM users WHERE is_active = 1 AND dept_id = ? AND role IN ('MANAGER','ADMIN') AND id != ? LIMIT 1`
    ).get(row.from_dept_id, me)?.id || null;
  }

  if (!otherId) {
    return res.status(404).json({ success: false, message: 'لا يوجد حساب مرتبط بالطرف الآخر بعد.' });
  }

  const convId = chat.openDm(me, otherId,
    `💬 نقاش حول المراسلة ${row.serial} — «${row.subject}»`);
  if (!convId) return res.status(500).json({ success: false, message: 'تعذر فتح المحادثة.' });

  logAudit(req.user, 'CORRESPONDENCE_DISCUSS', 'correspondence', row.id, { conversation_id: convId }, req.ip);
  res.json({ success: true, conversation_id: convId });
});

// ── POST /:id/approve ─────────────────────────────────────────────────────
router.post('/:id/approve', AUTH, (req, res) => {
  const user = req.user;
  const row  = db.prepare('SELECT * FROM correspondences WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'المراسلة غير موجودة.' });
  if (row.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'المراسلة ليست بانتظار الموافقة.' });
  }
  // The queue is the SENDING department's — a head never sees another
  // department's pending items, and admins bypass.
  if (!canApproveFor(user, row.from_dept_id)) {
    return res.status(403).json({ success: false, message: 'لا تملك صلاحية الموافقة على مراسلات هذا القسم.' });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE correspondences
         SET status = 'approved', approved_by_name = ?, approved_at = datetime('now','localtime'),
             updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(user.name || user.username, row.id);
    addEvent(row.id, 'approved', user, null, 0);
  })();

  logAudit(user, 'CORRESPONDENCE_APPROVED', 'correspondence', row.id, { from_dept_id: row.from_dept_id }, req.ip);
  const updated = hydrate(db.prepare('SELECT * FROM correspondences WHERE id = ?').get(row.id));
  notify.onApproved(updated);
  res.json({ success: true, item: updated });
});

// ── POST /:id/reject — reason is mandatory, enforced HERE not in the UI ───
router.post('/:id/reject', AUTH, (req, res) => {
  const user   = req.user;
  const reason = String(req.body?.reason || '').trim();
  const row    = db.prepare('SELECT * FROM correspondences WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'المراسلة غير موجودة.' });
  if (row.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'المراسلة ليست بانتظار الموافقة.' });
  }
  if (!canApproveFor(user, row.from_dept_id)) {
    return res.status(403).json({ success: false, message: 'لا تملك صلاحية رفض مراسلات هذا القسم.' });
  }
  if (!reason) {
    return res.status(400).json({ success: false, message: 'سبب الرفض مطلوب.' });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE correspondences
         SET status = 'returned', rejection_reason = ?, updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(reason, row.id);
    addEvent(row.id, 'rejected', user, reason, 1);
  })();

  logAudit(user, 'CORRESPONDENCE_REJECTED', 'correspondence', row.id, { reason }, req.ip);
  const updated = hydrate(db.prepare('SELECT * FROM correspondences WHERE id = ?').get(row.id));
  notify.onRejected(updated);
  res.json({ success: true, item: updated });
});

// ── POST /:id/complete — receiving department marks it done ───────────────
router.post('/:id/complete', AUTH, (req, res) => {
  const user = req.user;
  const row  = db.prepare('SELECT * FROM correspondences WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'المراسلة غير موجودة.' });
  if (row.status !== 'approved') {
    return res.status(400).json({ success: false, message: 'لا يمكن الإنجاز إلا بعد الموافقة.' });
  }
  if (!isAdmin(user) && !myDepartments(user).includes(row.to_dept_id)) {
    return res.status(403).json({ success: false, message: 'هذه المراسلة ليست موجهة إلى قسمك.' });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE correspondences
         SET status = 'done', completed_by_name = ?, completed_at = datetime('now','localtime'),
             updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(user.name || user.username, row.id);
    addEvent(row.id, 'completed', user, null, 0);
  })();

  logAudit(user, 'CORRESPONDENCE_COMPLETED', 'correspondence', row.id, { to_dept_id: row.to_dept_id }, req.ip);
  const updated = hydrate(db.prepare('SELECT * FROM correspondences WHERE id = ?').get(row.id));
  notify.onCompleted(updated);
  res.json({ success: true, item: updated });
});

module.exports = router;
module.exports.OTHER_SERVICE_ID = OTHER_SERVICE_ID;
