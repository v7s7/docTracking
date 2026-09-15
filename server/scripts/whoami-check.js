// server/scripts/whoami-check.js
//
//   node scripts/whoami-check.js <username>
//
// Answers two things about one person, from the real data, rather than
// guessing: which department(s) do they actually see and approve for, and
// why — plus whether they have a usable email address for notifications.
//
// Read-only. Changes nothing.
require('dotenv').config();
const { db } = require('../db');
const { readConfig } = require('../services/configService');
const { approversOf, ledDepartments, myDepartments, DEPT_APPROVER_ROLES } = require('../utils/approvals');

const username = process.argv[2];
if (!username) {
  console.error('\n  Usage: node scripts/whoami-check.js <username>\n');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) {
  console.error(`\n  No user row for "${username}".`);
  console.error('  If they can sign in but have no row, they are still sitting in');
  console.error('  "حسابات في الشبكة بدون صلاحية" on the Users page — assign them there first.\n');
  process.exit(1);
}

const { departments = [] } = readConfig();
const deptName = id => departments.find(d => d.id === id)?.label || id;

console.log(`\n  ${user.full_name}  (${user.username})\n`);

// ── The row itself ──────────────────────────────────────────
console.log('users row:');
console.log(`  dept_id    ${JSON.stringify(user.dept_id)}  →  ${user.dept_id ? deptName(user.dept_id) : '(none)'}`);
console.log(`  role       ${user.role}`);
console.log(`  email      ${user.email ? user.email : '(BLANK — cannot receive ANY email notification)'}`);
console.log(`  is_active  ${user.is_active ? 'yes' : 'NO — inactive accounts get nothing, in-app or email'}`);

// ── Every department this user leads, and why ───────────────
console.log('\nnamed head/deputy of, in config/departments.json:');
const led = departments.filter(d => {
  const names = approversOf(d.id);
  return names.some(n => String(n).trim().toLowerCase() === String(user.username).trim().toLowerCase());
});
if (!led.length) {
  console.log('  (none — not named head or deputy anywhere)');
} else {
  led.forEach(d => {
    const asHead   = d.head?.username?.trim().toLowerCase()   === user.username.trim().toLowerCase();
    const asDeputy = d.deputy?.username?.trim().toLowerCase() === user.username.trim().toLowerCase();
    console.log(`  ${d.id.padEnd(28)} ${d.label}  (as ${[asHead && 'head', asDeputy && 'deputy'].filter(Boolean).join(' + ')})`);
  });
}

// ── What this adds up to ─────────────────────────────────────
const mine = myDepartments(user);
console.log('\nmyDepartments() — every department this account sees/approves for:');
mine.forEach(id => console.log(`  ${id.padEnd(28)} ${deptName(id)}`));
if (mine.length > 1) {
  console.log(`\n  ${mine.length} departments, not 1 — this is a DUAL-ROLE account, not a bug in the`);
  console.log('  code: myDepartments() is deliberately "own department PLUS any they lead"');
  console.log('  (server/utils/approvals.js). To make this account single-department, remove');
  console.log(`  ${user.username} from the OTHER department's head/deputy in config/departments.json —`);
  console.log('  editable from the Super Admin panel, not by touching users.dept_id.');
}

// ── Would they have received the "incoming to my department" email? ──
if (user.dept_id) {
  console.log(`\nrecipients of an "incoming" email to ${deptName(user.dept_id)} right now:`);
  const rows = db.prepare("SELECT username, email, is_active FROM users WHERE dept_id = ?").all(user.dept_id);
  rows.forEach(r => console.log(`  ${r.is_active ? ' ' : 'X'} ${r.username.padEnd(20)} ${r.email || '(no email — silently skipped)'}`));
}

console.log('');
