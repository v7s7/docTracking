// server/utils/attachmentStore.js
//
// Where attachments live on disk, and how they get their names.
//
// Before this, every attachment the organisation ever received landed in one
// flat directory under an opaque name — 1787204107842-505140170.pdf. The
// database knew the mapping, but nothing else did: open a backup zip looking
// for "the letter HR sent in March" and there was no way to find it.
//
// Now:  data/correspondence-files/2026/IT-2026-001/3-رد-القسم.pdf
//                                 └yr┘ └─serial──┘ └id┘└─real name─┘
//
// The user is unaffected — downloads have always restored the original filename
// and still do. This is about what a human sees on the filesystem.
const fs = require('fs');
const path = require('path');

// multer names the file before the route handler runs, so the serial does not
// exist yet at write time. Uploads land here first and are moved once the row
// is committed and both the serial and the attachment id are known.
const STAGING = '_incoming';

// Characters Windows refuses in a filename, plus control characters. Written as
// escapes on purpose: a literal control byte in source is invisible and does
// not survive being passed through tooling.
const ILLEGAL = /[\\/:*?"<>|]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f]/g;

/**
 * Make a filename safe for Windows without destroying it.
 *
 * Arabic is preserved — NTFS handles it fine. Length is capped because the full
 * path has a 260-character limit by default and the memo folder above it is
 * already spending some of that.
 *
 * Reserved device names (CON, PRN, NUL, COM1…) need no special handling: every
 * file is prefixed with its attachment id, so the name is never exactly a
 * reserved word.
 */
function safeFileName(name) {
  const base = path.basename(String(name || 'file'));
  const ext  = path.extname(base);                    // includes the leading dot
  const stem = base.slice(0, base.length - ext.length);

  const strip = s => String(s).replace(ILLEGAL, '_').replace(CONTROL, '').trim();

  // The leading-dot rule belongs to the STEM only — ".env" as a stem is a hidden
  // file. An extension IS a leading dot by definition, and stripping it there
  // turned «رد.pdf» into «ردpdf».
  const safeStem = strip(stem).replace(/^\.+/, '').slice(0, 100) || 'file';
  const safeExt  = strip(ext).slice(0, 20);
  return safeStem + safeExt;
}

/** 2026/IT-2026-001 — year first so one directory never grows without limit. */
function folderFor(serial, createdAt) {
  const year = String(createdAt || '').slice(0, 4) || String(new Date().getFullYear());
  return path.join(/^\d{4}$/.test(year) ? year : String(new Date().getFullYear()),
                   safeFileName(serial || 'unfiled'));
}

/** multer storage that drops everything in the staging folder. */
function stagingStorage(multer, uploadDir) {
  const dir = path.join(uploadDir, STAGING);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    // Re-created per upload rather than only once when this module loads. If the
    // folder goes away while the server is running — a tidy-up, a restore, a
    // backup script — every upload otherwise fails with a generic
    // "تعذر رفع المرفقات" until somebody restarts the process, with nothing in
    // the log to say why. mkdirSync is a no-op when the folder already exists.
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return cb(e); }
      cb(null, dir);
    },
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  });
}

/** The relative path recorded in stored_name while a file is still in staging. */
const stagedName = diskName => `${STAGING}/${diskName}`;

/**
 * Move one staged file into its record's folder and return the new relative path.
 *
 * Called AFTER the row is committed, so a failure here is survivable: the
 * database still points at the staging copy, which resolves perfectly well. The
 * file is never lost, only less tidily filed.
 */
function commitFile(uploadDir, storedName, { serial, createdAt, attachmentId, originalName }) {
  const from = path.resolve(uploadDir, String(storedName));
  if (!fs.existsSync(from)) return storedName;

  const folder = folderFor(serial, createdAt);
  const target = path.join(uploadDir, folder);
  const finalName = `${attachmentId}-${safeFileName(originalName)}`;
  const to = path.join(target, finalName);

  try {
    fs.mkdirSync(target, { recursive: true });
    fs.renameSync(from, to);
    return `${folder.split(path.sep).join('/')}/${finalName}`;
  } catch (e) {
    console.warn('[Attachments] could not file', storedName, '->', finalName, ':', e.message);
    return storedName;   // still resolvable; the row stays valid
  }
}

/**
 * Resolve a stored path to a real one, refusing anything that escapes.
 *
 * Subdirectories are allowed now, so the old path.basename() guard is gone — but
 * the resolved path is still checked to sit inside the upload directory, so a
 * crafted "../../.env" cannot get out. Legacy flat names resolve unchanged.
 */
function resolveStored(uploadDir, storedName) {
  if (!storedName) return null;
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, String(storedName));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * File every still-staged attachment of one record into its folder.
 *
 * Runs AFTER the row is committed, never inside the transaction: moving a file
 * is not transactional, and a rollback could not put it back. If a move fails
 * the row keeps pointing at the staging copy, which still downloads correctly —
 * the file is only less tidily placed, never lost.
 *
 * `table` and `idColumn` are fixed literals from this codebase, not user input.
 */
function fileAll(db, uploadDir, { table, idColumn, recordId, serial, createdAt }) {
  const rows = db.prepare(
    `SELECT id, stored_name, file_name FROM ${table} WHERE ${idColumn} = ? AND stored_name LIKE ?`
  ).all(recordId, `${STAGING}/%`);
  if (!rows.length) return 0;

  const update = db.prepare(`UPDATE ${table} SET stored_name = ? WHERE id = ?`);
  let moved = 0;
  for (const r of rows) {
    const next = commitFile(uploadDir, r.stored_name, {
      serial, createdAt, attachmentId: r.id, originalName: r.file_name,
    });
    if (next !== r.stored_name) { update.run(next, r.id); moved += 1; }
  }
  return moved;
}

module.exports = {
  safeFileName, folderFor, stagingStorage, stagedName, commitFile, resolveStored, fileAll, STAGING,
};
