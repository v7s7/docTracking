// server/scripts/test-unread.js
//
// The nav badge invariant: everything the badge counts must sit in a thread the
// user can actually open. Break that and you get a number nobody can clear by
// reading — which is exactly what happened between Aug and Sep 2026, when 24
// messages were stuck behind conversation_members rows left over from the days
// when a department channel was readable by all 119 staff (7e255dd).
//
// It exercises the REAL exports from routes/messages.js. A test that spells the
// rule out again cannot notice the rule changing underneath it.
//
// Runs against a THROWAWAY database, built from scratch:
//   set DB_PATH=%TEMP%\unread-test.db && node scripts/test-unread.js
//
// cmd keeps that DB_PATH for the rest of the window. Clear it with `set DB_PATH=`
// before running unread-check.js, or that reads this throwaway file instead.
const fs   = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..');

const DBC = process.env.DB_PATH;
if (!DBC || path.basename(DBC).toLowerCase() === 'doctracking.db') {
  console.error('REFUSING TO RUN: set DB_PATH to a throwaway file. This writes test rows.');
  process.exit(2);
}
// Always start clean — a half-seeded leftover would assert against stale rows.
for (const f of [DBC, DBC + '-wal', DBC + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }

process.chdir(SERVER);
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const { db } = require(path.join(SERVER, 'db'));
const { canSeeConversation, myConversationIds, unreadCountFor } = require(path.join(SERVER, 'routes', 'messages'));

let pass = 0, fail = 0;
const ok = (c, m) => { console.log('  ' + (c ? '\u2713' : '\u2717') + ' ' + m); c ? pass++ : fail++; };

// ── the world ───────────────────────────────────────────────────────────────
const mkUser = (username, dept) => db.prepare(
  "INSERT INTO users (username, full_name, role, dept_id) VALUES (?,?,'STAFF',?)"
).run(username, username, dept).lastInsertRowid;

const mkConv = (type, dept, peer) => db.prepare(
  'INSERT INTO conversations (type, dept_id, peer_user_id) VALUES (?,?,?)'
).run(type, dept, peer).lastInsertRowid;

const say = (conv, sender, at) => db.prepare(
  "INSERT INTO messages (conversation_id, sender_id, sender_name, content, created_at) VALUES (?,?,'t','m',?)"
).run(conv, sender, at);

const member = (conv, user, readAt) => db.prepare(
  'INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?,?,?)'
).run(conv, user, readAt);

const it   = { id: mkUser('it1',  'it_dept'),       dept_id: 'it_dept' };
const hr   = { id: mkUser('hr1',  'hr_dept'),       dept_id: 'hr_dept' };
const out  = { id: mkUser('out1', 'accounts_dept'), dept_id: 'accounts_dept' };

const HR_TEAM = mkConv('department', 'hr_dept', null);   // HR's internal channel
const IT_TEAM = mkConv('department', 'it_dept', null);   // IT's internal channel
const OUT_HR  = mkConv('department', 'hr_dept', out.id); // out1's private thread with HR
const DM      = mkConv('dm', null, null);                // it1 <-> hr1

member(DM, it.id, null);
member(DM, hr.id, null);

// THE historical artifact: it1 read HR's channel back when anyone could, so a
// membership row exists for a department that is not theirs and never will be.
member(HR_TEAM, it.id, '2026-08-01 09:00:00');

say(HR_TEAM, hr.id, '2026-09-10 10:00:00');
say(HR_TEAM, hr.id, '2026-09-10 10:01:00');
say(IT_TEAM, hr.id, '2026-09-10 10:02:00');
say(OUT_HR,  hr.id, '2026-09-10 10:03:00');
say(DM,      hr.id, '2026-09-10 10:04:00');

const conv = id => db.prepare('SELECT * FROM conversations WHERE id=?').get(id);

// Unread in ONE conversation, counted the way GET /conversations counts it.
// Deliberately independent of CAN_OPEN: summing this over the listed threads is
// what makes the invariant below a real check and not a tautology.
const unreadIn = (convId, user) => {
  const m = db.prepare('SELECT last_read_at FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, user.id);
  const r = m ? m.last_read_at : null;
  return db.prepare(
    'SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND sender_id!=? AND (? IS NULL OR created_at > ?)'
  ).get(convId, user.id, r, r).n;
};

console.log('\n\u2014 the badge only counts threads the user can open \u2014');
for (const [name, u] of [['it1', it], ['hr1', hr], ['out1', out]]) {
  const listed = myConversationIds(u);
  const summed = listed.reduce((n, id) => n + unreadIn(id, u), 0);
  ok(unreadCountFor(u) === summed,
     `${name}: badge (${unreadCountFor(u)}) === sum over listed threads (${summed})`);
  ok(listed.every(id => canSeeConversation(conv(id), u)),
     `${name}: every listed thread passes canSeeConversation, so read cannot 403`);
}

console.log('\n\u2014 the stale membership row stays inert \u2014');
ok(!myConversationIds(it).includes(HR_TEAM), 'it1 is NOT given HR\u2019s channel by the leftover row');
ok(canSeeConversation(conv(HR_TEAM), it) === false, 'it1 cannot open HR\u2019s channel');
ok(unreadCountFor(it) === 2, 'it1 badge counts only its own team channel + the DM (2)');
ok(myConversationIds(hr).includes(HR_TEAM), 'hr1 still gets HR\u2019s channel, by department');
ok(canSeeConversation(conv(OUT_HR), out), 'out1 can still open its own thread with HR');
ok(!myConversationIds(out).includes(HR_TEAM), 'out1 does not get HR\u2019s internal channel');

console.log('\n\u2014 search cannot see further than the door \u2014');
// GET /search returns message bodies and sender names and does NOT re-check
// access on what it is handed, so its scope must be the same CAN_OPEN set.
// It used to union every conversation_members row, which made a department's
// private channel searchable by anyone holding a leftover row for it.
ok(!myConversationIds(it).includes(HR_TEAM), 'it1 cannot search HR\u2019s channel');
ok(myConversationIds(hr).includes(HR_TEAM), 'hr1 can still search its own channel');

console.log('\n\u2014 the rule stays written once \u2014');
// The check that would have caught this whole class up front. Two spellings of
// one predicate is how the badge, and then search, drifted away from
// canSeeConversation() without anything failing anywhere.
const src = fs.readFileSync(path.join(SERVER, 'routes', 'messages.js'), 'utf8');
const RULE = new RegExp('peer_user_id\\s*=\\s*\\?\\s+OR\\s+c?\\.?dept_id\\s*=\\s*\\?', 'g');
const spellings = (src.match(RULE) || []).length;
ok(spellings === 1,
   `the department-visibility predicate appears exactly once in messages.js (found ${spellings})`);

console.log('\n\u2014 hiding is a display preference, not a read \u2014');
db.prepare("UPDATE conversation_members SET hidden_at = datetime('now','localtime') WHERE conversation_id=? AND user_id=?").run(DM, it.id);
ok(unreadCountFor(it) === 2, 'a hidden chat still counts (the sidebar must show it somewhere)');
ok(myConversationIds(it).includes(DM), 'and it is still listed, so the UI can surface it');

console.log('\n\u2014 clearing everything actually reaches zero \u2014');
const now = db.prepare("SELECT datetime('now','localtime') as n").get().n;
for (const id of myConversationIds(it)) {
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?,?)').run(id, it.id);
  db.prepare('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?').run(now, id, it.id);
}
ok(unreadCountFor(it) === 0, 'POST /read-all drives the badge to 0');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
