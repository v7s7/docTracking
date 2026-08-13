// server/services/backupService.js
//
// Automatic backups of the one file that matters.
//
// WHY THIS IS NOT A COPY
// The database runs in WAL mode, so the recent writes live in doctracking.db-wal
// rather than in the .db file. Copying doctracking.db while the server is up
// therefore produces a file that is missing the newest data and may be torn
// mid-page. SQLite's own `VACUUM INTO` takes a transactionally consistent
// snapshot of the whole database while it is being written to, and compacts it
// on the way out — the correct primitive for a hot backup.
//
// WHY IT RUNS IN-PROCESS
// The server is already running as a service on the server PC. Putting the
// schedule here means a backup exists as soon as the app is deployed, with
// nothing else to install, remember or configure — and it cannot silently stop
// because someone deleted a scheduled task.
//
// WHAT IT KEEPS
//   data/backups/doctracking-YYYY-MM-DD-HHmm.db   the database
//   data/backups/attachments-YYYY-MM-DD.zip        correspondence files + avatars
// Daily backups are kept for BACKUP_KEEP_DAYS. One backup per calendar month is
// kept for BACKUP_KEEP_MONTHS, so a problem noticed late is still recoverable.
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP_DAYS   = Number(process.env.BACKUP_KEEP_DAYS   || 30);
const KEEP_MONTHS = Number(process.env.BACKUP_KEEP_MONTHS || 12);
const AT_HOUR     = Number(process.env.BACKUP_HOUR || 1);      // 01:00 local

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stampMin = d => `${stamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`;

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Take one snapshot. Returns { file, bytes, ms } or throws.
 * Safe to call at any time — it does not block writers.
 */
function backupDatabase() {
  ensureDir();
  const started = Date.now();
  const file = path.join(BACKUP_DIR, `doctracking-${stampMin(new Date())}.db`);

  // VACUUM INTO refuses to overwrite, which is what we want — a repeated run in
  // the same minute should not clobber a good snapshot.
  if (fs.existsSync(file)) return { file, bytes: fs.statSync(file).size, ms: 0, skipped: true };

  // The path goes in as a bound parameter would be ideal, but VACUUM INTO does
  // not accept one. Backslashes and quotes are the only characters that could
  // break out of the literal, and both are escaped here.
  const literal = file.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${literal}'`);

  const bytes = fs.statSync(file).size;
  return { file, bytes, ms: Date.now() - started };
}

/**
 * Zip the attachment folders. Uses PowerShell's Compress-Archive on Windows and
 * `zip` elsewhere; if neither is available the database backup still succeeds,
 * because losing the attachments is bad but losing the database is worse.
 */
function backupAttachments() {
  ensureDir();
  const target = path.join(BACKUP_DIR, `attachments-${stamp(new Date())}.zip`);
  if (fs.existsSync(target)) return Promise.resolve({ file: target, skipped: true });

  const sources = ['correspondence-files', 'uploads']
    .map(d => path.join(DATA_DIR, d))
    .filter(fs.existsSync);
  if (!sources.length) return Promise.resolve({ file: null, skipped: true });

  const isWin = process.platform === 'win32';
  const cmd  = isWin ? 'powershell.exe' : 'zip';
  const args = isWin
    ? ['-NoProfile', '-NonInteractive', '-Command',
       `Compress-Archive -Path ${sources.map(s => `'${s}'`).join(',')} -DestinationPath '${target}' -Force`]
    : ['-rq', target, ...sources];

  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 10 * 60 * 1000 }, err => {
      if (err) {
        console.warn('[Backup] attachments skipped:', err.message);
        return resolve({ file: null, error: err.message });
      }
      resolve({ file: target, bytes: fs.existsSync(target) ? fs.statSync(target).size : 0 });
    });
  });
}

/**
 * Delete backups outside the retention window, keeping the first backup of each
 * month. Only ever touches files this service created — the name pattern is the
 * guard, so nothing else in the folder can be caught by it.
 */
function prune() {
  if (!fs.existsSync(BACKUP_DIR)) return { deleted: 0 };
  const now = Date.now();
  const dayMs = 86400000;
  const keptMonths = new Set();
  let deleted = 0;

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^(doctracking-\d{4}-\d{2}-\d{2}-\d{4}\.db|attachments-\d{4}-\d{2}-\d{2}\.zip)$/.test(f))
    .sort();   // oldest first, so the month's first backup is the one kept

  for (const f of files) {
    const m = f.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const ageDays = (now - when.getTime()) / dayMs;
    if (ageDays <= KEEP_DAYS) continue;

    const monthKey = `${m[1]}-${m[2]}-${f.startsWith('attachments') ? 'a' : 'd'}`;
    if (!keptMonths.has(monthKey) && ageDays <= KEEP_MONTHS * 31) {
      keptMonths.add(monthKey);          // keep one per month
      continue;
    }
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); deleted++; }
    catch (e) { console.warn('[Backup] could not delete', f, e.message); }
  }
  return { deleted };
}

/** Everything, in order. Returns a summary suitable for logging or an API. */
async function runBackup(reason = 'scheduled') {
  const t0 = Date.now();
  const dbRes = backupDatabase();
  const atRes = await backupAttachments();
  const pr    = prune();
  const mb    = (dbRes.bytes / 1048576).toFixed(1);
  console.log(`[Backup] ${reason}: ${path.basename(dbRes.file)} (${mb} MB)`
    + `${atRes.file ? ` + ${path.basename(atRes.file)}` : ''}`
    + `${pr.deleted ? `, pruned ${pr.deleted}` : ''}`
    + ` in ${Date.now() - t0}ms`);
  return { database: dbRes, attachments: atRes, pruned: pr.deleted };
}

/** What is on disk right now, newest first. */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => /^(doctracking-.*\.db|attachments-.*\.zip)$/.test(f))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * Schedule the nightly run. Checks every 15 minutes rather than sleeping until
 * the exact hour: a laptop that suspends, a service that restarts, or a clock
 * change would each defeat a single long timer.
 */
function startBackupScheduler() {
  let lastRunDay = null;

  // Catch-up on boot: if today's backup has not been taken and it is already
  // past the hour, take it now rather than waiting until tomorrow.
  const tick = () => {
    try {
      const now = new Date();
      const today = stamp(now);
      if (lastRunDay === today) return;
      if (now.getHours() < AT_HOUR) return;
      const already = fs.existsSync(BACKUP_DIR)
        && fs.readdirSync(BACKUP_DIR).some(f => f.startsWith(`doctracking-${today}`));
      if (already) { lastRunDay = today; return; }
      lastRunDay = today;
      runBackup('nightly').catch(e => console.warn('[Backup] failed:', e.message));
    } catch (e) {
      console.warn('[Backup] scheduler error:', e.message);
    }
  };

  setTimeout(tick, 30_000);                    // shortly after boot
  const timer = setInterval(tick, 15 * 60_000);
  timer.unref?.();
  console.log(`[Backup] scheduler started — nightly at ${pad(AT_HOUR)}:00, `
    + `keeping ${KEEP_DAYS} days and ${KEEP_MONTHS} monthly, in ${BACKUP_DIR}`);
}

module.exports = { runBackup, backupDatabase, backupAttachments, prune, listBackups, startBackupScheduler, BACKUP_DIR };
