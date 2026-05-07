const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'doctracking.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    full_name     TEXT NOT NULL,
    email         TEXT,
    role          TEXT NOT NULL DEFAULT 'STAFF',
    dept_id       TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    created_by    TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    serial          TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'incoming',
    priority        TEXT NOT NULL DEFAULT 'normal',
    status          TEXT NOT NULL DEFAULT 'new',
    source_entity   TEXT,
    delivery_method TEXT,
    current_dept_id TEXT,
    expected_at     TEXT,
    completed_at    TEXT,
    extra_data      TEXT,
    created_by_id   INTEGER,
    created_by_name TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL,
    type       TEXT NOT NULL,
    from_dept  TEXT,
    to_dept    TEXT,
    actor_id   INTEGER,
    actor_name TEXT,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_dept     ON tasks(current_dept_id);
  CREATE INDEX IF NOT EXISTS idx_events_task_id ON task_events(task_id);
`);

// ── Serial number helper ─────────────────────────────────────
function nextSerial() {
  const year = new Date().getFullYear();
  const row  = db.prepare(
    "SELECT serial FROM tasks WHERE serial LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${year}-%`);
  const n = row ? parseInt(row.serial.split('-')[1], 10) + 1 : 1;
  return `${year}-${String(n).padStart(4, '0')}`;
}

console.log(`[DB] SQLite ready: ${DB_PATH}`);

module.exports = { db, nextSerial };
