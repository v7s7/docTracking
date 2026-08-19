// server/routes/circulars.js
// التعاميم — one author, no routing, no approval, everyone is the audience.
//
// The shape is deliberately NOT correspondence:
//   • no status column and no workflow — a تعميم is published, not processed
//   • no visibilityClause() — that helper is department-scoped, and a تعميم that
//     only some departments could read would not be a تعميم. Every authenticated
//     user reads every circular.
//   • unread is a RECEIPT (NOT EXISTS in circular_reads), never a fan-out. A
//     fan-out row-per-user written at publish time would silently skip everyone
//     hired afterwards, and "no تعميم lost" is the entire point of the feature.
//
// Publishing authority lives in utils/circularAuth.js — the رئيس/نائب named on
// the signing office in config/departments.json, and nobody else.
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { db }          = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const { logAudit }    = require('../utils/audit');
const { decodeUploadName } = require('../utils/uploadName');
const { sendMail }    = require('../services/mailService');
const {
  SOURCES, SOURCE_CODE, isSource,
  canPublishCircular, publishableSources, canModifyCircular,
} = require('../utils/circularAuth');

const router = express.Router();
const AUTH   = verifyToken;

// ── File storage ──────────────────────────────────────────────────────────
// Same reasoning as correspondence: NOT under data/uploads, which index.js
// serves as unauthenticated static files.
const UPLOAD_DIR  = path.join(__dirname, '..', 'data', 'circular-files');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES   = 10 * 1024 * 1024;
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

// Delete files already on disk when the request is rejected after multer ran.
function discardUploads(req) {
  for (const f of req.files || []) fs.unlink(f.path, () => {});
}

function fail(req, res, code, message) {
  discardUploads(req);
  return res.status(code).json({ success: false, message });
}

// ── Serial: DC-2026-0001 / DG-2026-0001 ───────────────────────────────────
function nextSerial(source) {
  const prefix = SOURCE_CODE[source];
  const year   = new Date().getFullYear();
  const like   = `${prefix}-${year}-%`;
  const last   = db.prepare(
    'SELECT serial FROM circulars WHERE serial LIKE ? ORDER BY id DESC LIMIT 1'
  ).get(like);
  const n = last ? (parseInt(String(last.serial).split('-').pop(), 10) || 0) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

const attachmentsOf = id => db.prepare(
  'SELECT id, file_name, file_type, file_size FROM circular_attachments WHERE circular_id = ? ORDER BY id'
).all(id);

const readerCount = id => db.prepare(
  'SELECT COUNT(*) n FROM circular_reads WHERE circular_id = ?'
).get(id).n;

// Everyone who should have read it. Active accounts only — a departed employee
// must not make a تعميم look permanently unacknowledged.
const audienceCount = () => db.prepare(
  'SELECT COUNT(*) n FROM users WHERE is_active = 1'
).get().n;

// ── GET / — the list, with search and filters ─────────────────────────────
router.get('/', AUTH, (req, res) => {
  const { source, search, from, to, unread, limit = 100, offset = 0 } = req.query;
  const uid = req.user?.id ?? -1;

  const where = [];
  const params = [];

  if (source) {
    if (!isSource(source)) return res.status(400).json({ success: false, message: 'نوع التعميم غير معروف.' });
    where.push('c.source = ?');
    params.push(source);
  }
  if (search) {
    where.push('(c.title LIKE ? OR c.body LIKE ? OR c.serial LIKE ? OR c.published_by_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (from) { where.push('c.created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to)   { where.push('c.created_at <= ?'); params.push(`${to} 23:59:59`); }
  if (unread === '1' || unread === 'true') {
    where.push('NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?)');
    params.push(uid);
  }

  const sql = `FROM circulars c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...params).n;
  const rows  = db.prepare(`
    SELECT c.*,
           EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?) AS is_read,
           (SELECT COUNT(*) FROM circular_attachments a WHERE a.circular_id = c.id) AS attachment_count
    ${sql}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `).all(uid, ...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0);

  res.json({ success: true, total, items: rows });
});

// ── GET /stats — sidebar badges + whether to offer the compose button ─────
// Registered before /:id so "stats" is never read as an id.
router.get('/stats', AUTH, (req, res) => {
  const uid = req.user?.id ?? -1;
  const unread = {};
  for (const s of SOURCES) {
    unread[s] = db.prepare(`
      SELECT COUNT(*) n FROM circulars c
       WHERE c.source = ?
         AND NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?)
    `).get(s, uid).n;
  }
  res.json({ success: true, unread, canPublish: publishableSources(req.user) });
});

// ── GET /notifications — unread circulars for the header bell ─────────────
// Computed live rather than stored, so a user created today still sees every
// circular published before they existed.
router.get('/notifications', AUTH, (req, res) => {
  const uid = req.user?.id ?? -1;
  const items = db.prepare(`
    SELECT c.id, c.serial, c.source, c.title, c.created_at
      FROM circulars c
     WHERE NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 20
  `).all(uid);
  res.json({ success: true, unread: items.length, items });
});

// ── GET /:id — one circular ───────────────────────────────────────────────
router.get('/:id', AUTH, (req, res) => {
  const uid = req.user?.id ?? -1;
  const row = db.prepare('SELECT * FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });

  res.json({
    success: true,
    item: {
      ...row,
      attachments:  attachmentsOf(row.id),
      // Live lookup, not stored: published_by_name is a snapshot of who signed
      // it, but the extension should be the one that reaches them today.
      published_by_ext: row.published_by_id
        ? (db.prepare('SELECT ext FROM users WHERE id = ?').get(row.published_by_id) || {}).ext || null
        : null,
      is_read:      !!db.prepare('SELECT 1 FROM circular_reads WHERE circular_id = ? AND user_id = ?').get(row.id, uid),
      read_count:   readerCount(row.id),
      audience:     audienceCount(),
      can_modify:   canModifyCircular(req.user, row),
    },
  });
});

// ── GET /:id/readers — who has read it, who has not ───────────────────────
// Restricted to whoever may modify the تعميم: this is the "chase the people who
// have not read it" screen, not something every employee needs.
router.get('/:id/readers', AUTH, (req, res) => {
  const row = db.prepare('SELECT * FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });
  if (!canModifyCircular(req.user, row)) {
    return res.status(403).json({ success: false, message: 'لا تملك صلاحية الاطلاع على قائمة القراءة.' });
  }

  const read = db.prepare(`
    SELECT u.id, u.full_name, u.dept_id, u.ext, r.read_at
      FROM circular_reads r JOIN users u ON u.id = r.user_id
     WHERE r.circular_id = ? AND u.is_active = 1
     ORDER BY r.read_at DESC
  `).all(row.id);

  const unread = db.prepare(`
    SELECT u.id, u.full_name, u.dept_id, u.ext
      FROM users u
     WHERE u.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = ? AND r.user_id = u.id)
     ORDER BY u.dept_id, u.full_name COLLATE NOCASE
  `).all(row.id);

  res.json({ success: true, read, unread });
});

// ── GET /:id/attachments/:attId — authorised download ─────────────────────
router.get('/:id/attachments/:attId', AUTH, (req, res) => {
  const row = db.prepare('SELECT id FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });

  const att = db.prepare(
    'SELECT * FROM circular_attachments WHERE id = ? AND circular_id = ?'
  ).get(req.params.attId, row.id);
  if (!att) return res.status(404).json({ success: false, message: 'المرفق غير موجود.' });

  const full = path.join(UPLOAD_DIR, path.basename(att.stored_name));
  if (!fs.existsSync(full)) {
    return res.status(410).json({ success: false, message: 'الملف لم يعد موجوداً على الخادم.' });
  }
  res.download(full, att.file_name);
});

// ── POST /:id/read — record the receipt ───────────────────────────────────
router.post('/:id/read', AUTH, (req, res) => {
  const uid = req.user?.id;
  if (!uid) return res.status(401).json({ success: false, message: 'غير مصرح.' });
  const row = db.prepare('SELECT id FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });

  db.prepare(
    'INSERT OR IGNORE INTO circular_reads (circular_id, user_id) VALUES (?, ?)'
  ).run(row.id, uid);
  res.json({ success: true });
});

// ── POST / — publish ──────────────────────────────────────────────────────
router.post('/', AUTH, withUploads, (req, res) => {
  const user = req.user;
  const { source, title, body } = req.body || {};

  if (!isSource(source)) return fail(req, res, 400, 'نوع التعميم غير معروف.');
  if (!canPublishCircular(user, source)) {
    return fail(req, res, 403, 'لا تملك صلاحية إصدار هذا التعميم. يصدره رئيس المكتب أو نائبه فقط.');
  }
  if (!String(title || '').trim()) return fail(req, res, 400, 'عنوان التعميم مطلوب.');
  if (!String(body  || '').trim()) return fail(req, res, 400, 'نص التعميم مطلوب.');

  const serial = nextSerial(source);
  let id;
  try {
    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO circulars (serial, source, title, body, published_by_id, published_by_name, published_by_dept)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(serial, source, String(title).trim(), String(body).trim(),
             user.id, user.full_name || user.name || user.username, user.dept_id || null);
      id = info.lastInsertRowid;

      const ins = db.prepare(`
        INSERT INTO circular_attachments (circular_id, stored_name, file_name, file_type, file_size)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const f of req.files || []) {
        ins.run(id, path.basename(f.path), decodeUploadName(f.originalname), f.mimetype, f.size);
      }

      // The publisher has plainly read their own تعميم.
      db.prepare('INSERT OR IGNORE INTO circular_reads (circular_id, user_id) VALUES (?, ?)').run(id, user.id);
    })();
  } catch (e) {
    console.error('[Circulars] publish failed:', e.message);
    return fail(req, res, 500, 'تعذر إصدار التعميم.');
  }

  logAudit(user, 'CIRCULAR_PUBLISHED', 'circular', id, { serial, source }, req.ip);
  emailEveryone({ id, serial, source, title: String(title).trim() });

  res.json({ success: true, id, serial });
});

// ── PUT /:id — correct a published تعميم ──────────────────────────────────
router.put('/:id', AUTH, withUploads, (req, res) => {
  const row = db.prepare('SELECT * FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return fail(req, res, 404, 'التعميم غير موجود.');
  if (!canModifyCircular(req.user, row)) {
    return fail(req, res, 403, 'لا تملك صلاحية تعديل هذا التعميم.');
  }

  const title = String(req.body?.title ?? row.title).trim();
  const body  = String(req.body?.body  ?? row.body).trim();
  if (!title) return fail(req, res, 400, 'عنوان التعميم مطلوب.');
  if (!body)  return fail(req, res, 400, 'نص التعميم مطلوب.');

  db.transaction(() => {
    // edited_at is what the UI turns into the «مُعدّل» marker, so readers can
    // tell that the text changed after they read it.
    db.prepare(`
      UPDATE circulars
         SET title = ?, body = ?,
             edited_at  = datetime('now','localtime'),
             updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(title, body, row.id);

    const ins = db.prepare(`
      INSERT INTO circular_attachments (circular_id, stored_name, file_name, file_type, file_size)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const f of req.files || []) {
      ins.run(row.id, path.basename(f.path), decodeUploadName(f.originalname), f.mimetype, f.size);
    }
  })();

  logAudit(req.user, 'CIRCULAR_EDITED', 'circular', row.id, { serial: row.serial }, req.ip);
  res.json({ success: true });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id', AUTH, (req, res) => {
  const row = db.prepare('SELECT * FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });
  if (!canModifyCircular(req.user, row)) {
    return res.status(403).json({ success: false, message: 'لا تملك صلاحية حذف هذا التعميم.' });
  }

  const files = db.prepare('SELECT stored_name FROM circular_attachments WHERE circular_id = ?').all(row.id);
  // ON DELETE CASCADE clears circular_attachments and circular_reads.
  db.prepare('DELETE FROM circulars WHERE id = ?').run(row.id);
  for (const f of files) fs.unlink(path.join(UPLOAD_DIR, path.basename(f.stored_name)), () => {});

  logAudit(req.user, 'CIRCULAR_DELETED', 'circular', row.id, { serial: row.serial }, req.ip);
  res.json({ success: true });
});

// ── Email on publish ──────────────────────────────────────────────────────
// Best-effort and never throws: a mail server that is down must not stop a
// تعميم being published. The sidebar badge is the reliable channel; email is
// the nudge for people who are not logged in today.
const LABEL = {
  deputy_chairman:  'تعميم نائب الرئيس',
  director_general: 'تعميم المدير العام',
};

function emailEveryone(item) {
  try {
    const rows = db.prepare(
      "SELECT email FROM users WHERE is_active = 1 AND email IS NOT NULL AND email <> ''"
    ).all();
    const to = rows.map(r => r.email).filter(Boolean);
    if (!to.length) return;

    const kind = LABEL[item.source] || 'تعميم';
    const url  = process.env.APP_URL || '';
    sendMail({
      to,
      subject: `${kind} — ${item.title}`,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">
        <h3 style="margin:0 0 .5rem">${kind}</h3>
        <p style="margin:0 0 .25rem"><b>${item.title}</b></p>
        <p style="margin:0;color:#555">رقم التعميم: ${item.serial}</p>
        ${url ? `<p style="margin:1rem 0 0"><a href="${url}">فتح النظام</a></p>` : ''}
      </div>`,
      text: `${kind}\n${item.title}\nرقم التعميم: ${item.serial}`,
    }).catch(e => console.warn('[Circulars] email failed:', e.message));
  } catch (e) {
    console.warn('[Circulars] email step failed:', e.message);
  }
}

module.exports = router;
