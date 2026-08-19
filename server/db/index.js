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
if (!userCols.includes('status_text')) {
  db.exec("ALTER TABLE users ADD COLUMN status_text TEXT");
}
if (!userCols.includes('last_chat_reminder_at')) {
  db.exec("ALTER TABLE users ADD COLUMN last_chat_reminder_at TEXT");
}
if (!userCols.includes('avatar_url')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
}
if (!userCols.includes('avatar_color')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT");
}
// Phone directory fields. The 4-digit داخلي is what staff actually look each
// other up by, and it lived only in config/directory.json where no query could
// reach it. Populated by scripts/link-directory.js --apply.
if (!userCols.includes('ext')) {
  db.exec("ALTER TABLE users ADD COLUMN ext TEXT");
}
if (!userCols.includes('mobile')) {
  db.exec("ALTER TABLE users ADD COLUMN mobile TEXT");
}
// A second work address. Several people conduct work correspondence from a
// personal @gmail.com as well as their @swd.bh mailbox, and the directory has
// to show both — one column cannot hold two addresses without hiding one.
if (!userCols.includes('alt_email')) {
  db.exec("ALTER TABLE users ADD COLUMN alt_email TEXT");
}

const convCols = db.prepare("PRAGMA table_info(conversations)").all().map(c => c.name);
if (!convCols.includes('avatar_url')) {
  db.exec("ALTER TABLE conversations ADD COLUMN avatar_url TEXT");
}
if (!convCols.includes('avatar_color')) {
  db.exec("ALTER TABLE conversations ADD COLUMN avatar_color TEXT");
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
if (!messageCols.includes('reply_to_id')) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)");
}
if (!messageCols.includes('pinned_at')) {
  db.exec("ALTER TABLE messages ADD COLUMN pinned_at TEXT");
}
if (!messageCols.includes('pinned_by')) {
  db.exec("ALTER TABLE messages ADD COLUMN pinned_by TEXT");
}
if (!messageCols.includes('translated_en')) {
  db.exec("ALTER TABLE messages ADD COLUMN translated_en TEXT");
}
if (!messageCols.includes('translated_ar')) {
  db.exec("ALTER TABLE messages ADD COLUMN translated_ar TEXT");
}

const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
if (!taskCols.includes('last_reminder_at')) {
  db.exec("ALTER TABLE tasks ADD COLUMN last_reminder_at TEXT");
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

// ── نظام المراسلات الداخلية — internal correspondence ─────────
// Deliberately separate from `tasks` (Customer-Service hub routing) and from
// `messages` (chat). A correspondence is a formal memo sent department →
// department that must clear the SENDER's own department head before the
// receiving department ever sees it.
//
//   pending  بانتظار الموافقة  — waiting on the sending department's head
//   approved موافق عليها       — cleared; now visible to the receiving department
//   done     تم الإنجاز        — receiving department completed the work
//   returned مُعادة للمراجعة   — rejected with a reason, back with the author
//
// A rejected memo keeps its id and serial through every reject/resubmit cycle;
// only the timeline grows.
db.exec(`
  CREATE TABLE IF NOT EXISTS correspondences (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    serial            TEXT UNIQUE,
    subject           TEXT NOT NULL,
    body              TEXT NOT NULL,
    service_id        TEXT,
    from_user_id      INTEGER NOT NULL,
    from_user_name    TEXT NOT NULL,
    from_dept_id      TEXT NOT NULL,
    to_dept_id        TEXT NOT NULL,
    priority          TEXT NOT NULL DEFAULT 'med',
    status            TEXT NOT NULL DEFAULT 'pending',
    rejection_reason  TEXT,
    approved_by_name  TEXT,
    approved_at       TEXT,
    completed_by_name TEXT,
    completed_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK (status   IN ('pending','approved','done','returned')),
    CHECK (priority IN ('high','med','low')),
    CHECK (from_dept_id <> to_dept_id)
  );

  CREATE TABLE IF NOT EXISTS correspondence_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    correspondence_id INTEGER NOT NULL,
    type              TEXT NOT NULL,
    actor_id          INTEGER,
    actor_name        TEXT NOT NULL,
    note              TEXT,
    is_reject         INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(correspondence_id) REFERENCES correspondences(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS correspondence_attachments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    correspondence_id INTEGER NOT NULL,
    stored_name       TEXT NOT NULL,
    file_name         TEXT NOT NULL,
    file_type         TEXT,
    file_size         INTEGER,
    uploaded_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(correspondence_id) REFERENCES correspondences(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_corr_from    ON correspondences(from_dept_id, status);
  CREATE INDEX IF NOT EXISTS idx_corr_to      ON correspondences(to_dept_id, status);
  CREATE INDEX IF NOT EXISTS idx_corr_author  ON correspondences(from_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_corr_events  ON correspondence_events(correspondence_id, id);
  CREATE INDEX IF NOT EXISTS idx_corr_attach  ON correspondence_attachments(correspondence_id);
`);

// ── Two-way correspondence: whose turn, and per-reply attachments ────────
// Added after first release, so ALTER rather than a changed CREATE — the same
// pattern as the users/conversations migrations higher up this file.
//
// awaiting_dept_id is the department the memo is currently sitting with. It is
// NOT derivable from status: once قسم A and قسم B start replying to each other
// the status stays 'approved' the whole time, and only this column says whose
// move it is. NULL once the memo is closed.
const corrCols = db.prepare("PRAGMA table_info(correspondences)").all().map(c => c.name);
if (!corrCols.includes('awaiting_dept_id')) {
  db.exec("ALTER TABLE correspondences ADD COLUMN awaiting_dept_id TEXT");
  // Backfill from the status each existing memo is in:
  //   pending / returned → قسم A must act (approve it, or fix and resend)
  //   approved           → قسم B must act
  //   done               → nobody
  db.exec(`
    UPDATE correspondences SET awaiting_dept_id =
      CASE status
        WHEN 'pending'  THEN from_dept_id
        WHEN 'returned' THEN from_dept_id
        WHEN 'approved' THEN to_dept_id
        ELSE NULL
      END
  `);
}

// event_id ties an attachment to the reply it came with. NULL means it was part
// of the original memo, which is exactly what every existing row is — so the
// backfill is "do nothing" and old attachments keep rendering where they always did.
const corrAttCols = db.prepare("PRAGMA table_info(correspondence_attachments)").all().map(c => c.name);
if (!corrAttCols.includes('event_id')) {
  db.exec("ALTER TABLE correspondence_attachments ADD COLUMN event_id INTEGER");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_corr_att_event ON correspondence_attachments(event_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_corr_awaiting  ON correspondences(awaiting_dept_id, status)");

// ── التعاميم — circulars ─────────────────────────────────────
// A تعميم is the opposite shape to a correspondence: one author, no routing,
// no approval chain, and EVERY employee is the audience. So there is no status
// column and no visibilityClause() here — a circular that only some departments
// could read would not be a تعميم.
//
//   source  'deputy_chairman'  → تعميم نائب الرئيس   (مكتب نائب الرئيس)
//           'director_general' → تعميم المدير العام  (مكتب المدير العام)
//
// Who may publish is NOT stored here — it is derived from the head/deputy named
// on the matching department in config/departments.json, via utils/circularAuth.js.
// Keeping it out of the row means moving a manager updates who can publish with
// no data migration.
//
// circular_reads is a RECEIPT, not a fan-out: a row appears only once a person
// has actually opened the circular. Unread is therefore NOT EXISTS, which keeps
// working for employees hired after publication — the fan-out used by
// correspondence_notifications would silently miss them, and "no تعميم lost" is
// the whole point of the feature.
db.exec(`
  CREATE TABLE IF NOT EXISTS circulars (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    serial            TEXT UNIQUE,
    source            TEXT NOT NULL,
    title             TEXT NOT NULL,
    body              TEXT NOT NULL,
    published_by_id   INTEGER,
    published_by_name TEXT NOT NULL,
    published_by_dept TEXT,
    edited_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK (source IN ('deputy_chairman','director_general'))
  );

  CREATE TABLE IF NOT EXISTS circular_attachments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    circular_id  INTEGER NOT NULL,
    stored_name  TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    file_type    TEXT,
    file_size    INTEGER,
    uploaded_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(circular_id) REFERENCES circulars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS circular_reads (
    circular_id INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    read_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (circular_id, user_id),
    FOREIGN KEY(circular_id) REFERENCES circulars(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_circ_source     ON circulars(source, created_at);
  CREATE INDEX IF NOT EXISTS idx_circ_attach     ON circular_attachments(circular_id);
  CREATE INDEX IF NOT EXISTS idx_circ_reads_user ON circular_reads(user_id);
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
