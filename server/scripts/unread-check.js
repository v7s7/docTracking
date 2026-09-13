// server/scripts/unread-check.js
//
// "The المحادثات badge says N" — this says which threads make up the N, and
// flags anything the UI gives no way to clear.
//
// It calls the REAL unreadCountFor() / myConversationIds() / canSeeConversation()
// out of routes/messages.js, so its numbers ARE the numbers the app shows. The
// first version of this script kept its own copy of the badge query and went on
// reporting a fixed server as broken — the same mistake the fix was about, made
// in the tool built to detect it. Do not reintroduce a local copy.
//
//   node scripts/unread-check.js            # every user whose badge is > 0
//   node scripts/unread-check.js a.kandi    # one user
const path = require('path');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const { db } = require(path.join(SERVER, 'db'));
const { unreadCountFor, myConversationIds, canSeeConversation } =
  require(path.join(SERVER, 'routes', 'messages'));

const cfg = require(path.join(SERVER, 'config', 'departments.json')).departments || [];
const deptLabel = id => (cfg.find(d => d.id === id) || {}).label || id || '—';
const H = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

console.log('\ndatabase: ' + (process.env.DB_PATH || path.join(SERVER, 'data', 'doctracking.db')));

const who = process.argv[2];
const users = who
  ? db.prepare('SELECT id, username, full_name, dept_id FROM users WHERE username = ?').all(who)
  : db.prepare('SELECT id, username, full_name, dept_id FROM users WHERE is_active = 1').all();
if (who && !users.length) { console.log(`\nno user "${who}".`); process.exit(1); }

const conv = id => db.prepare('SELECT * FROM conversations WHERE id=?').get(id);

// Unread in ONE thread, the way GET /conversations counts it for the list.
const unreadIn = (convId, user) => {
  const m = db.prepare('SELECT last_read_at, hidden_at FROM conversation_members WHERE conversation_id=? AND user_id=?')
    .get(convId, user.id);
  const r = m ? m.last_read_at : null;
  const n = db.prepare(
    'SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND sender_id!=? AND (? IS NULL OR created_at > ?)'
  ).get(convId, user.id, r, r).n;
  return { n, lastRead: r, hidden: !!(m && m.hidden_at) };
};

const name = c => c.type === 'department'
  ? `${deptLabel(c.dept_id)}${c.peer_user_id ? ' / thread #' + c.id : ' (internal)'}`
  : `${c.type} #${c.id}`;

// Department threads the user holds a conversation_members row for but cannot
// open. Before Aug 2026 a department channel was readable by all 119 staff, so
// opening one left a row behind (7e255dd). They are NOT counted any more — the
// badge, the list and /search all bind CAN_OPEN — but they are worth seeing.
const legacyRows = user => db.prepare(`
  SELECT c.id FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE cm.user_id = ? AND c.type = 'department'
`).all(user.id).map(r => conv(r.id)).filter(c => !canSeeConversation(c, user));

let stuck = 0, legacy = 0, shown = 0;

for (const u of users) {
  const badge = unreadCountFor(u);
  const stale = legacyRows(u);
  if (!badge && !stale.length) continue;
  shown++;

  H(`${u.full_name}  (${u.username}, ${deptLabel(u.dept_id)})   badge = ${badge}`);

  for (const id of myConversationIds(u)) {
    const { n, lastRead, hidden } = unreadIn(id, u);
    if (!n) continue;
    const c = conv(id);
    let why;
    if (!canSeeConversation(c, u)) { why = 'STUCK — counted but not openable'; stuck += n; }
    else if (hidden)   why = 'hidden — shown on the "المحادثات المخفية" header';
    else if (!lastRead) why = 'never opened — no read marker, so every message counts';
    else                why = 'unread since ' + lastRead;
    console.log(`  ${String(n).padStart(3)}  ${name(c).padEnd(46)} ${why}`);
  }

  for (const c of stale) {
    const n = db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND sender_id!=?').get(c.id, u.id).n;
    legacy++;
    console.log(`  ${'—'.padStart(3)}  ${name(c).padEnd(46)} legacy membership row, NOT counted (${n} msg in thread)`);
  }
}

H('Summary');
if (!shown) console.log('  Nothing unread anywhere, and no legacy rows.');
console.log(`  ${stuck} message(s) counted by the badge that the UI cannot clear.`);
console.log(`  ${legacy} legacy membership row(s) on departments the holder cannot open.`);
if (!stuck) {
  console.log('');
  console.log('  0 stuck is the expected result. The legacy rows above are inert:');
  console.log('  CAN_OPEN ignores them, so they reach neither the badge, the list,');
  console.log('  nor /search. They are left in place because deleting them would');
  console.log('  throw away the record of who once had access. Everything still');
  console.log('  listed is real unread, clearable by opening it or by the');
  console.log('  mark-all-read button in the chat sidebar.');
} else {
  console.log('');
  console.log('  Anything STUCK means this server is running a build older than the');
  console.log('  one where the badge, the list and /search were bound to CAN_OPEN.');
}
console.log('');
