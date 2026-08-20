// server/scripts/demo-check.js
//
// "What will this person actually see when they log in?"
//
// Correspondence visibility is now scoped by department, so an account with no
// traffic of its own sees empty screens — correct, but alarming if you meet it
// for the first time in front of an audience. This answers it before then.
//
//   node scripts/demo-check.js                 -> every account that can publish a تعميم
//   node scripts/demo-check.js a.alkubaesy     -> one specific person
//
// Read-only. Touches nothing.
require('dotenv').config();
const { db } = require('../db');
const { readConfig } = require('../services/configService');
const { visibilityClause, approvalQueueFor, myDepartments } = require('../utils/approvals');
const ca = require('../utils/circularAuth');

const deptLabel = id => (readConfig().departments || []).find(d => d.id === id)?.label || id || '—';

function seenBy(user) {
  const { clause, params } = visibilityClause(user);
  const where = clause ? `WHERE ${clause}` : '';
  const total = db.prepare('SELECT COUNT(*) n FROM correspondences').get().n;
  const mine  = db.prepare(`SELECT COUNT(*) n FROM correspondences c ${where}`).get(...params).n;

  const queue = approvalQueueFor(user);
  const pending = queue.length
    ? db.prepare(`SELECT COUNT(*) n FROM correspondences WHERE status='pending' AND from_dept_id IN (${queue.map(() => '?').join(',')})`).get(...queue).n
    : 0;

  const depts = myDepartments(user);
  const inbox = depts.length
    ? db.prepare(`SELECT COUNT(*) n FROM correspondences WHERE awaiting_dept_id IN (${depts.map(() => '?').join(',')}) AND status='approved'`).get(...depts).n
    : 0;

  const chats = db.prepare(`
    SELECT COUNT(*) n FROM conversations c
     WHERE (c.type='department' AND (c.peer_user_id = ? OR c.dept_id = ?))
        OR (c.type IN ('dm','group') AND EXISTS (
              SELECT 1 FROM conversation_members m WHERE m.conversation_id=c.id AND m.user_id=?))
  `).get(user.id, user.dept_id || '', user.id).n;

  const circulars = db.prepare('SELECT COUNT(*) n FROM circulars').get().n;

  return { total, mine, pending, inbox, chats, circulars, canPublish: ca.publishableSources(user) };
}

function report(user) {
  const s = seenBy(user);
  const warn = [];
  if (s.mine === 0 && s.total > 0) warn.push('الأرشيف will be EMPTY — this account has no correspondence of its own');
  if (!s.canPublish.length)        warn.push('cannot publish any تعميم — the compose button will not appear');
  if (s.circulars === 0)           warn.push('no تعاميم exist yet — both screens show the empty state');
  if (s.chats <= 1)                warn.push(`only ${s.chats} chat conversation(s)`);

  console.log(`\n── ${user.full_name}  (${user.username})`);
  console.log(`   role ${user.role}   ·   ${deptLabel(user.dept_id)}`);
  console.log(`   الأرشيف        ${s.mine} of ${s.total} in the database`);
  console.log(`   صندوق الوارد   ${s.inbox}`);
  console.log(`   الموافقات      ${s.pending}`);
  console.log(`   المحادثات      ${s.chats}`);
  console.log(`   التعاميم       ${s.circulars} published · can publish: ${s.canPublish.length ? s.canPublish.join(', ') : 'nothing'}`);
  warn.forEach(w => console.log(`   ⚠  ${w}`));
  return warn.length === 0;
}

const who = process.argv[2];
const users = who
  ? db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').all(who)
  : (() => {
      // Default: whoever can actually demonstrate التعاميم, since that is the
      // feature with the narrowest set of accounts able to show it.
      const names = new Set();
      for (const deptId of Object.values(ca.SOURCE_DEPT)) {
        const d = (readConfig().departments || []).find(x => x.id === deptId);
        for (const slot of ['head', 'deputy']) if (d?.[slot]?.username) names.add(d[slot].username.toLowerCase());
      }
      return [...names].flatMap(u => db.prepare('SELECT * FROM users WHERE lower(username)=?').all(u));
    })();

if (!users.length) { console.log('no matching user'); process.exit(0); }

console.log('WHAT EACH ACCOUNT SEES AFTER TODAY\'S VISIBILITY CHANGES');
let clean = 0;
for (const u of users) if (report(u)) clean++;
console.log(`\n${clean} of ${users.length} account(s) would demo without an empty screen.`);
console.log('Correspondence is scoped by department now — pick an account with real traffic.\n');
