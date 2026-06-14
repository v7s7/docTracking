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

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_id    TEXT NOT NULL,
    task_id    INTEGER NOT NULL,
    task_serial TEXT,
    task_title  TEXT,
    type       TEXT NOT NULL DEFAULT 'forwarded',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_dept     ON tasks(current_dept_id);
  CREATE INDEX IF NOT EXISTS idx_events_task_id ON task_events(task_id);
  CREATE INDEX IF NOT EXISTS idx_notifs_dept    ON notifications(dept_id, is_read);

  CREATE TABLE IF NOT EXISTS sessions (
    jti        TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    full_name  TEXT,
    role       TEXT,
    ip         TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_username TEXT NOT NULL,
    actor_role     TEXT,
    action         TEXT NOT NULL,
    target_type    TEXT,
    target_id      TEXT,
    details        TEXT,
    ip             TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK(type IN ('dm','department','group')),
    dept_id     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    last_read_at     TEXT,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id       INTEGER NOT NULL,
    sender_name     TEXT NOT NULL,
    content         TEXT,
    file_url        TEXT,
    file_name       TEXT,
    file_type       TEXT,
    file_size       INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conv_dept         ON conversations(dept_id);

  CREATE TABLE IF NOT EXISTS task_templates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'incoming',
    priority        TEXT NOT NULL DEFAULT 'normal',
    source_entity   TEXT,
    delivery_method TEXT,
    expected_days   INTEGER,
    note            TEXT,
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(username);
  CREATE INDEX IF NOT EXISTS idx_audit_actor      ON audit_log(actor_username);
  CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_log(action);
`);

// ── Migrations for columns added after initial release ────────
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('last_seen_at')) {
  db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT");
}
if (!userCols.includes('presence_status')) {
  db.exec("ALTER TABLE users ADD COLUMN presence_status TEXT");
}

// SQLite can't ALTER a CHECK constraint — recreate the table if an older
// version doesn't yet allow the 'group' conversation type.
const convTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'").get()?.sql || '';
if (convTableSql && !convTableSql.includes("'group'")) {
  // Build the replacement table under a fresh name and rename it into place
  // afterwards. Renaming the OLD table instead would make SQLite rewrite the
  // conversation_members/messages FK clauses to point at the old table's new
  // name, leaving them dangling (and cascade-deleting their rows) once it's
  // dropped.
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE conversations_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('dm','department','group')),
      dept_id     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO conversations_new (id, type, dept_id, created_at) SELECT id, type, dept_id, created_at FROM conversations;
    DROP TABLE conversations;
    ALTER TABLE conversations_new RENAME TO conversations;
    CREATE INDEX IF NOT EXISTS idx_conv_dept ON conversations(dept_id);
    PRAGMA foreign_keys = ON;
  `);
}

const convMemberCols = db.prepare("PRAGMA table_info(conversation_members)").all().map(c => c.name);
if (!convMemberCols.includes('hidden_at')) {
  db.exec("ALTER TABLE conversation_members ADD COLUMN hidden_at TEXT");
}

const messageCols = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
if (!messageCols.includes('mentions')) {
  db.exec("ALTER TABLE messages ADD COLUMN mentions TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS message_mentions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    is_read         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_mentions_conv ON message_mentions(conversation_id, user_id);

  CREATE TABLE IF NOT EXISTS message_reactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id);
`);

// ── Serial number helper ─────────────────────────────────────
// Format: PREFIX-YYYY-NNNN  (e.g. CS-2026-0001)
// Prefix is read from TASK_SERIAL_PREFIX env var, defaults to "CS"
function nextSerial() {
  const prefix = (process.env.TASK_SERIAL_PREFIX || 'CS').toUpperCase();
  const year   = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;
  const row = db.prepare(
    "SELECT serial FROM tasks WHERE serial LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(pattern);
  let n = 1;
  if (row) {
    const parts = row.serial.split('-');
    n = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

console.log(`[DB] SQLite ready: ${DB_PATH}`);

module.exports = { db, nextSerial };
