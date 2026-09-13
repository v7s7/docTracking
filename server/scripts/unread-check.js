// server/scripts/unread-check.js
//
// "The المحادثات badge says N and I have read everything" — this says which
// threads make up the N, and which of them the UI gives you no way to clear.
//
// Run it on the machine that serves real users; the PC checkout has different
// data and will happily report a clean bill of health.
//
//   node scripts/unread-check.js            # every user whose badge is > 0
//   node scripts/unread-check.js a.kandi    # one user
//
// This script deliberately reimplements the three scopes instead of importing
// them — comparing them IS the job, so it has to hold both sides of the
// comparison at once. Keep them in step with routes/messages.js:
//   badge      unreadCountFor()      <- GET /messages/unread-count
//   list       myConversationIds()   <- GET /messages/conversations
//   canRead    canSeeConversation()  <- gates POST /:id/read and GET /search
// All three now bind one predicate, CAN_OPEN. scripts/test-unread.js asserts it
// stays that way; this script is the matching check against real data.
//
// The badge query here is the PRE-FIX, wider one: it admits a department thread
// on a conversation_members row alone. /unread-count no longer does. That is on
// purpose — a server still running the old build counts those rows, and this
// script has to be able to explain the number that server is showing. Anything
// it labels STUCK disappears from the badge as soon as the fix is deployed.
const path = require('path');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const DB = process.env.DB_PATH || path.join(SERVER, 'data', 'doctracking.db');
const db = require(path.join(SERVER, 'node_modules', 'better-sqlite3'))(DB, { readonly: true });
const cfg = require(path.join(SERVER, 'config', 'departments.json')).departments || [];

const deptLabel = id => (cfg.find(d => d.id === id) || {}).label || id || '—';
const H = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

console.log('\ndatabase: ' + DB);

const who = process.argv[2];
const users = who
  ? db.prepare('SELECT id, username, full_name, dept_id FROM users WHERE username = ?').all(who)
  : db.prepare('SELECT id, username, full_name, dept_id FROM users WHERE is_active = 1').all();

if (who && !users.length) { console.log(`\nno user "${who}".`); process.exit(1); }

// The badge, counted exactly the way /unread-count counts it.
const badgeOf = u => db.prepare(`
  SELECT COUNT(*) as n FROM messages msg
  JOIN conversations c ON c.id = msg.conversation_id
  LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
  WHERE msg.sender_id != ?
    AND (cm.user_id IS NOT NULL
         OR (c.type = 'department' AND (c.peer_user_id = ? OR c.dept_id = ?)))
    AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
`).get(u.id, u.id, u.id, u.dept_id || '').n;

// Same rows, but one line each, so we can attribute every message to a thread.
const rowsOf = u => db.prepare(`
  SELECT c.id, c.type, c.dept_id, c.peer_user_id,
         cm.user_id AS member, cm.last_read_at, cm.hidden_at,
         COUNT(*) AS n, MAX(msg.created_at) AS newest
  FROM messages msg
  JOIN conversations c ON c.id = msg.conversation_id
  LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
  WHERE msg.sender_id != ?
    AND (cm.user_id IS NOT NULL
         OR (c.type = 'department' AND (c.peer_user_id = ? OR c.dept_id = ?)))
    AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
  GROUP BY c.id ORDER BY n DESC
`).all(u.id, u.id, u.id, u.dept_id || '');

// canSeeConversation() — false here means POST /conversations/:id/read answers
// 403, so no amount of reading in the UI will ever clear this thread.
const canRead = (r, u) => r.type !== 'department'
  ? !!r.member
  : (!!r.dept_id && String(u.dept_id || '') === String(r.dept_id))
    || (!!r.peer_user_id && Number(r.peer_user_id) === Number(u.id));

// Is it in GET /conversations at all? Department threads are listed by dept or
// peer — never by membership row; dm/group are listed by membership row only.
const isListed = (r, u) => r.type === 'department'
  ? (Number(r.peer_user_id) === Number(u.id) || String(r.dept_id) === String(u.dept_id || ''))
  : !!r.member;

let stuckTotal = 0;

for (const u of users) {
  const badge = badgeOf(u);
  if (!badge) continue;

  H(`${u.full_name}  (${u.username}, ${deptLabel(u.dept_id)})   badge = ${badge}`);

  for (const r of rowsOf(u)) {
    const name = r.type === 'department'
      ? `${deptLabel(r.dept_id)}${r.peer_user_id ? ' / thread #' + r.id : ' (internal)'}`
      : `${r.type} #${r.id}`;

    let why;
    if (!canRead(r, u))       { why = 'STUCK — not readable (403); nothing in the UI can clear it'; stuckTotal += r.n; }
    else if (!isListed(r, u)) { why = 'STUCK — readable but never listed by /conversations';        stuckTotal += r.n; }
    else if (r.hidden_at)     { why = 'hidden — open the "المحادثات المخفية" section to clear';      }
    else if (!r.last_read_at) { why = 'never opened — no read marker, so every message counts';      }
    else                      { why = 'unread since ' + r.last_read_at;                              }

    console.log(`  ${String(r.n).padStart(3)}  ${name.padEnd(46)} ${why}`);
    console.log(`       newest ${r.newest}`);
  }
}

H('Summary');
if (stuckTotal) {
  console.log(`  ${stuckTotal} message(s) sit in threads the UI gives you no way to open.`);
  console.log('  Cause: the old /unread-count admitted any department thread you held a');
  console.log('  conversation_members row for, while /conversations and canSeeConversation');
  console.log('  admit it only when it is your department or your own thread — and a');
  console.log('  membership row outlives a change of dept_id.');
  console.log('');
  console.log('  Fixed in routes/messages.js. If this server still shows the number,');
  console.log('  it is running the old build: deploy, then restart node.');
} else {
  console.log('  Every counted message sits in a thread this user can open. No stuck badge.');
}
console.log('');
