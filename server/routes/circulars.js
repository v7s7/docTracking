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
const store = require('../utils/attachmentStore');
const { sendMail }    = require('../services/mailService');
const { layout, meta } = require('../services/emailTemplate');
const { readConfig }  = require('../services/configService');
const {
  SOURCES, sourceCode, isSource,
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
  // Staged first, then filed under 2026/<serial>/ once the serial exists —
  // multer runs before the handler, so it cannot know the serial yet.
  storage: store.stagingStorage(multer, UPLOAD_DIR),
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
  // Same shape as correspondence — VP-2026-001 — and the prefix comes from the
  // signing office's code in departments.json, so both features stay in step.
  const prefix = sourceCode(source);
  const year   = new Date().getFullYear();
  const last   = db.prepare(
    'SELECT serial FROM circulars WHERE serial LIKE ? ORDER BY serial DESC LIMIT 1'
  ).get(`${prefix}-${year}-%`);
  const n = last ? (parseInt(String(last.serial).split('-').pop(), 10) || 0) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

const attachmentsOf = id => db.prepare(
  'SELECT id, file_name, file_type, file_size FROM circular_attachments WHERE circular_id = ? ORDER BY id'
).all(id);

const deptLabelOf = id =>
  (readConfig().departments || []).find(d => d.id === id)?.label || id || '';

/** The stored target list as an array, or null for "everyone". */
const storedTargets = raw => {
  if (!raw) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) && a.length ? a : null; }
  catch { return null; }
};

// Both counts are scoped to the تعميم's own audience, and both count only
// ACTIVE accounts. «قرأه ٤٣ من ١٢٠» against a تعميم that was only ever sent to
// three departments would be a meaningless fraction, and a departed employee
// must not make one look permanently unacknowledged.
//
// readerCount joins users for the same reason — without it a reader who has
// since been deactivated still counts, and read_count could exceed audience.
const readerCount = (id, targetDepts) => {
  const ids = storedTargets(targetDepts);
  const scope = ids ? ` AND u.dept_id IN (${ids.map(() => '?').join(',')})` : '';
  return db.prepare(`
    SELECT COUNT(*) n FROM circular_reads r
      JOIN users u ON u.id = r.user_id
     WHERE r.circular_id = ? AND u.is_active = 1${scope}
  `).get(id, ...(ids || [])).n;
};

const audienceCount = (targetDepts) => {
  const ids = storedTargets(targetDepts);
  const scope = ids ? ` AND dept_id IN (${ids.map(() => '?').join(',')})` : '';
  return db.prepare(
    `SELECT COUNT(*) n FROM users WHERE is_active = 1${scope}`
  ).get(...(ids || [])).n;
};

// ── GET / — the list, with search and filters ─────────────────────────────
/**
 * SQL fragment scoping circulars to the people they were addressed to.
 *
 * URD 6.7 allows a تعميم «موجّه لجميع المستخدمين أو لأقسام محددة». ONE clause,
 * used by the list, the badge counts, the bell and the single read — the same
 * discipline as utils/approvals.js and for the same reasons: a تعميم must never
 * appear in a list the caller is refused when they open it, and must never be
 * counted in a badge that points at something they cannot see.
 *
 *   target_depts NULL → everyone. Every تعميم published before this column
 *                       existed is NULL, so nothing retroactively disappears.
 *   target_depts JSON → the named departments, plus whoever published it — the
 *                       publisher would otherwise lose sight of their own تعميم
 *                       the moment they addressed it to a department they are
 *                       not a member of.
 */
function audienceClause(user, table = 'c') {
  return {
    clause: `(${table}.target_depts IS NULL`
          + ` OR ${table}.published_by_id = ?`
          + ` OR EXISTS (SELECT 1 FROM json_each(${table}.target_depts) WHERE value = ?))`,
    params: [user?.id ?? -1, String(user?.dept_id || '')],
  };
}

/**
 * Validates a submitted target list against the live department config.
 * Returns { value } — a JSON string, or null for "everyone" — or { error }.
 * An empty selection is treated as "everyone", never as "nobody".
 */
function parseTargets(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); }
    catch { list = raw.split(',').map(s => s.trim()).filter(Boolean); }
  }
  if (!Array.isArray(list)) return { error: 'قائمة الأقسام غير صحيحة.' };
  const ids = [...new Set(list.map(String).map(s => s.trim()).filter(Boolean))];
  if (!ids.length) return { value: null };

  const known = new Set((readConfig().departments || []).map(d => d.id));
  const bad = ids.filter(id => !known.has(id));
  if (bad.length) return { error: `قسم غير معروف: ${bad.join('، ')}` };
  // Every department selected is the same as no restriction — store NULL so the
  // تعميم reads as org-wide everywhere rather than as a list that happens to
  // cover everyone today and silently narrows when a department is added.
  if (ids.length === known.size) return { value: null };
  return { value: JSON.stringify(ids) };
}

router.get('/', AUTH, (req, res) => {
  const { source, search, from, to, unread, limit = 100, offset = 0 } = req.query;
  const uid = req.user?.id ?? -1;

  const aud = audienceClause(req.user);
  const where = [aud.clause];
  const params = [...aud.params];

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
  const aud = audienceClause(req.user);
  const unread = {};
  for (const s of SOURCES) {
    unread[s] = db.prepare(`
      SELECT COUNT(*) n FROM circulars c
       WHERE c.source = ?
         AND ${aud.clause}
         AND NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?)
    `).get(s, ...aud.params, uid).n;
  }
  res.json({ success: true, unread, canPublish: publishableSources(req.user) });
});

// ── GET /notifications — unread circulars for the header bell ─────────────
// Computed live rather than stored, so a user created today still sees every
// circular published before they existed.
router.get('/notifications', AUTH, (req, res) => {
  const uid = req.user?.id ?? -1;
  const aud = audienceClause(req.user);
  const items = db.prepare(`
    SELECT c.id, c.serial, c.source, c.title, c.created_at
      FROM circulars c
     WHERE ${aud.clause}
       AND NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = c.id AND r.user_id = ?)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 20
  `).all(...aud.params, uid);
  res.json({ success: true, unread: items.length, items });
});

// ── GET /:id — one circular ───────────────────────────────────────────────
router.get('/:id', AUTH, (req, res) => {
  const uid = req.user?.id ?? -1;
  const aud = audienceClause(req.user);
  // Gated with the SAME clause the list uses, so a targeted تعميم cannot be
  // reached by typing its id — and so nothing the list shows can 404 here.
  const row = db.prepare(`SELECT c.* FROM circulars c WHERE c.id = ? AND ${aud.clause}`)
                .get(req.params.id, ...aud.params);
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
      read_count:   readerCount(row.id, row.target_depts),
      audience:     audienceCount(row.target_depts),
      can_modify:   canModifyCircular(req.user, row),
      // Ids for the composer to pre-select when correcting a تعميم, labels for
      // the screen to print. Sending only labels would make the editor guess
      // ids back from names; sending only ids would give the screen its own
      // name map to drift out of step with the config.
      target_depts_list: storedTargets(row.target_depts) || [],
      target_labels:    (storedTargets(row.target_depts) || []).map(deptLabelOf),
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

  // Both lists narrow to the target departments. Listing 120 people as "has not
  // read it" for a تعميم that was addressed to three departments would turn the
  // one screen built for chasing acknowledgement into noise.
  const tIds  = storedTargets(row.target_depts);
  const tScope = tIds ? ` AND u.dept_id IN (${tIds.map(() => '?').join(',')})` : '';
  const tArgs  = tIds || [];

  const read = db.prepare(`
    SELECT u.id, u.full_name, u.dept_id, u.ext, r.read_at
      FROM circular_reads r JOIN users u ON u.id = r.user_id
     WHERE r.circular_id = ? AND u.is_active = 1${tScope}
     ORDER BY r.read_at DESC
  `).all(row.id, ...tArgs);

  const unread = db.prepare(`
    SELECT u.id, u.full_name, u.dept_id, u.ext
      FROM users u
     WHERE u.is_active = 1${tScope}
       AND NOT EXISTS (SELECT 1 FROM circular_reads r WHERE r.circular_id = ? AND r.user_id = u.id)
     ORDER BY u.dept_id, u.full_name COLLATE NOCASE
  `).all(...tArgs, row.id);

  // dept_label travels with dept_id so this list doesn't need the client's own
  // hardcoded name map — read live, so a department renamed five minutes ago
  // already shows correctly here, the same as everywhere else this pattern is
  // used (from_dept_label, to_dept_label, ...).
  const { departments = [] } = readConfig();
  const labelOf = id => departments.find(d => d.id === id)?.label || id || '';
  const withLabel = rows => rows.map(u => ({ ...u, dept_label: labelOf(u.dept_id) }));

  res.json({ success: true, read: withLabel(read), unread: withLabel(unread) });
});

// ── GET /:id/attachments/:attId — authorised download ─────────────────────
router.get('/:id/attachments/:attId', AUTH, (req, res) => {
  const row = db.prepare('SELECT id FROM circulars WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'التعميم غير موجود.' });

  const att = db.prepare(
    'SELECT * FROM circular_attachments WHERE id = ? AND circular_id = ?'
  ).get(req.params.attId, row.id);
  if (!att) return res.status(404).json({ success: false, message: 'المرفق غير موجود.' });

  const full = store.resolveStored(UPLOAD_DIR, att.stored_name);
  if (!full) return res.status(400).json({ success: false, message: 'مسار المرفق غير صالح.' });
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

  const targets = parseTargets(req.body?.target_depts);
  if (targets.error) return fail(req, res, 400, targets.error);

  const serial = nextSerial(source);
  let id;
  try {
    db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO circulars (serial, source, title, body, published_by_id, published_by_name, published_by_dept, target_depts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(serial, source, String(title).trim(), String(body).trim(),
             user.id, user.full_name || user.name || user.username, user.dept_id || null,
             targets.value);
      id = info.lastInsertRowid;

      const ins = db.prepare(`
        INSERT INTO circular_attachments (circular_id, stored_name, file_name, file_type, file_size)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const f of req.files || []) {
        ins.run(id, store.stagedName(path.basename(f.path)), decodeUploadName(f.originalname), f.mimetype, f.size);
      }

      // The publisher has plainly read their own تعميم.
      db.prepare('INSERT OR IGNORE INTO circular_reads (circular_id, user_id) VALUES (?, ?)').run(id, user.id);
    })();
  } catch (e) {
    console.error('[Circulars] publish failed:', e.message);
    return fail(req, res, 500, 'تعذر إصدار التعميم.');
  }


  // Move the uploads out of staging into 2026/<serial>/ now the row exists.
  store.fileAll(db, UPLOAD_DIR, { table: 'circular_attachments',
    idColumn: 'circular_id', recordId: id, serial: serial, createdAt: db.prepare('SELECT created_at FROM circulars WHERE id = ?').get(id)?.created_at });
  logAudit(user, 'CIRCULAR_PUBLISHED', 'circular', id, { serial, source }, req.ip);
  emailEveryone({ id, serial, source, title: String(title).trim(), target_depts: targets.value });

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

  // Omitting the field entirely leaves the audience alone; sending it replaces
  // it. Narrowing an existing تعميم is allowed — the read receipts of anyone
  // dropped are kept, so widening it again restores them rather than asking
  // those people to acknowledge it a second time.
  const retarget = req.body?.target_depts !== undefined;
  const targets  = retarget ? parseTargets(req.body.target_depts) : null;
  if (targets?.error) return fail(req, res, 400, targets.error);

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

    if (retarget) {
      db.prepare('UPDATE circulars SET target_depts = ? WHERE id = ?').run(targets.value, row.id);
    }

    const ins = db.prepare(`
      INSERT INTO circular_attachments (circular_id, stored_name, file_name, file_type, file_size)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const f of req.files || []) {
      ins.run(row.id, store.stagedName(path.basename(f.path)), decodeUploadName(f.originalname), f.mimetype, f.size);
    }
  })();


  // Move the uploads out of staging into 2026/<serial>/ now the row exists.
  store.fileAll(db, UPLOAD_DIR, { table: 'circular_attachments',
    idColumn: 'circular_id', recordId: row.id, serial: row.serial, createdAt: row.created_at });
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
  for (const f of files) {
    const p = store.resolveStored(UPLOAD_DIR, f.stored_name);
    if (p) fs.unlink(p, () => {});
  }

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
    // "Everyone" means the تعميم's audience, which since URD 6.7 is not always
    // the whole directorate. Emailing 120 people about a تعميم addressed to
    // three departments is exactly the noise targeting exists to prevent — and
    // it would also hand them a link to something the API then refuses.
    const ids   = storedTargets(item.target_depts);
    const scope = ids ? ` AND dept_id IN (${ids.map(() => '?').join(',')})` : '';
    const rows  = db.prepare(
      `SELECT email FROM users
        WHERE is_active = 1 AND email IS NOT NULL AND email <> ''${scope}`
    ).all(...(ids || []));
    const to = rows.map(r => r.email).filter(Boolean);
    if (!to.length) return;

    const kind = LABEL[item.source] || 'تعميم';
    const url  = process.env.APP_URL || '';
    // layout()/meta() escape every field internally — item.title reaches here
    // as typed by whoever published it, and the previous version put it into
    // the HTML unescaped. A تعميم reaches literally everyone active in the
    // organisation, which makes it the single highest-reach email this system
    // sends and the worst possible place to have skipped that.
    sendMail({
      to,
      subject: `${kind} — ${item.title}`,
      html: layout({
        title: kind,
        lead: item.title,
        bodyHtml: meta([['رقم التعميم', item.serial]]),
        ctaUrl: url,
        ctaLabel: 'فتح التعميم',
      }),
      text: `${kind}\n${item.title}\nرقم التعميم: ${item.serial}`,
    }).catch(e => console.warn('[Circulars] email failed:', e.message));
  } catch (e) {
    console.warn('[Circulars] email step failed:', e.message);
  }
}

module.exports = router;
