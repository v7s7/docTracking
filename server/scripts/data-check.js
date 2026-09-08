// server/scripts/data-check.js
//
// The facts that live in the DATABASE, not in git — so they differ between the
// PC checkout and the server, and only the server's answers count. Every figure
// quoted in a requirements trace or a status report should come from here,
// run on the machine that serves real users.
//
//   node scripts/data-check.js
const path = require('path');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

const DB = process.env.DB_PATH || path.join(SERVER, 'data', 'doctracking.db');
const db = require(path.join(SERVER, 'node_modules', 'better-sqlite3'))(DB, { readonly: true });
const cfg = require(path.join(SERVER, 'config', 'departments.json')).departments || [];

// Call the REAL approversOf rather than reimplementing it. head and deputy are
// OBJECTS carrying a username, not strings — a hand-rolled copy that treats them
// as strings matches nothing and reports every department as leaderless, which is
// exactly the confidently-wrong number this script exists to prevent.
const { approversOf } = require(path.join(SERVER, 'utils', 'approvals'));

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const H = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

console.log('\ndatabase: ' + DB);

H('People');
const active = one('SELECT COUNT(*) n FROM users WHERE is_active=1').n;
const mail   = one("SELECT COUNT(*) n FROM users WHERE is_active=1 AND TRIM(COALESCE(email,''))<>''").n;
const ext    = one("SELECT COUNT(*) n FROM users WHERE is_active=1 AND TRIM(COALESCE(ext,''))<>''").n;
console.log('  active accounts            : ' + active);
console.log('  with an email address      : ' + mail + (mail < active ? '   <-- ' + (active - mail) + ' get NO email notification of anything' : ''));
console.log('  with a phone extension     : ' + ext + '   (دليل الهاتف depends on this)');
all("SELECT role, COUNT(*) n FROM users WHERE is_active=1 GROUP BY role ORDER BY n DESC")
  .forEach(r => console.log('  role ' + String(r.role).padEnd(22) + r.n));

H('Who actually holds مدير النظام');
// effectiveRole() grants it by IT-department membership and by the .env override,
// so the role column in the users table is NOT the answer.
const IT = process.env.IT_DEPT_ID || 'it_dept';
const overrides = (process.env.SUPER_ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const effective = all(
  "SELECT username, full_name, role, dept_id FROM users WHERE is_active=1 AND (role='SUPER_ADMIN' OR dept_id=?)", IT
).concat(overrides.length
  ? all(`SELECT username, full_name, role, dept_id FROM users WHERE is_active=1 AND LOWER(username) IN (${overrides.map(() => '?').join(',')}) AND dept_id<>?`, ...overrides, IT)
  : []);
console.log('  rows whose role column says SUPER_ADMIN : ' + one("SELECT COUNT(*) n FROM users WHERE is_active=1 AND role='SUPER_ADMIN'").n);
console.log('  accounts that ACTUALLY get it           : ' + effective.length);
effective.forEach(u => console.log('     ' + String(u.username).padEnd(16) + 'shown in the UI as ' + String(u.role).padEnd(9) + ' (' + u.dept_id + ')'));

H('Departments');
const pop = new Map(all("SELECT COALESCE(dept_id,'') d, COUNT(*) n FROM users WHERE is_active=1 GROUP BY dept_id").map(r => [r.d, r.n]));
const headOf = d => approversOf(d.id).map(s => String(s).toLowerCase());
const activeNames = new Set(all('SELECT username FROM users WHERE is_active=1').map(u => String(u.username).toLowerCase()));
let empty = [], noApprover = [], twoApprovers = [];
cfg.forEach(d => {
  const n = pop.get(d.id) || 0;
  const appr = headOf(d).filter(u => activeNames.has(u));
  if (!n) empty.push(d.label);
  else if (!appr.length) noApprover.push(d.label + '  (' + n + ' staff)');
  else if (appr.length > 1) twoApprovers.push(d.label);
});
console.log('  configured                 : ' + cfg.length);
console.log('  populated                  : ' + (cfg.length - empty.length));
console.log('  with 2 co-equal approvers  : ' + twoApprovers.length + '   (URD 8.1 assumes exactly one)');
if (empty.length)      { console.log('\n  EMPTY — still offered as a recipient, so a memo sent here can never be closed:'); empty.forEach(l => console.log('     ' + l)); }
if (noApprover.length) { console.log('\n  STAFF BUT NO رئيس قسم — their memos sit pending forever:');            noApprover.forEach(l => console.log('     ' + l)); }

H('Approvers who sit in a DIFFERENT department');
// URD 8.2 says only مدير النظام may approve outside his own department. Config
// head/deputy is a second path the document does not describe: whoever is named
// on a department approves for it regardless of their own dept_id.
const rowOf = u => one('SELECT username, full_name, dept_id FROM users WHERE LOWER(username)=LOWER(?)', u);
const foreign = [];
const leads = new Map();
cfg.forEach(d => headOf(d).forEach(u => {
  const r = rowOf(u); if (!r) return;
  leads.set(r.username, (leads.get(r.username) || []).concat(d.label));
  if (r.dept_id !== d.id) foreign.push('  ' + String(r.username).padEnd(24) + 'of ' + r.dept_id + '  approves for  ' + d.label);
}));
if (foreign.length) { console.log('  ' + foreign.length + ' such pairings — URD 8.2 does not allow this:'); foreign.forEach(l => console.log(l)); }
else console.log('  none');
const multi = [...leads.entries()].filter(([, ds]) => ds.length > 1);
if (multi.length) {
  console.log('');
  console.log('  people who lead more than one department:');
  multi.forEach(([u, ds]) => console.log('    ' + String(u).padEnd(24) + ds.join('  +  ')));
}

H('Departments whose approver cannot be emailed');
const unreachable = cfg.filter(d => (pop.get(d.id) || 0) > 0).filter(d => {
  const names = headOf(d).filter(u => activeNames.has(u));
  if (!names.length) return false;
  const row = one(`SELECT COUNT(*) n FROM users WHERE is_active=1 AND TRIM(COALESCE(email,''))<>'' AND LOWER(username) IN (${names.map(() => '?').join(',')})`, ...names);
  return row.n === 0;
});
console.log('  ' + unreachable.length + ' of ' + cfg.filter(d => (pop.get(d.id) || 0) > 0).length + ' populated departments');
unreachable.slice(0, 8).forEach(d => console.log('     ' + d.label));
if (unreachable.length > 8) console.log('     ... and ' + (unreachable.length - 8) + ' more');

H('Content');
console.log('  correspondences            : ' + one('SELECT COUNT(*) n FROM correspondences').n);
console.log('  circulars                  : ' + one('SELECT COUNT(*) n FROM circulars').n);
console.log('  chat messages              : ' + one('SELECT COUNT(*) n FROM messages').n);
console.log('  live sessions              : ' + one('SELECT COUNT(*) n FROM sessions').n);
const sw = one("SELECT value, updated_by, updated_at FROM app_settings WHERE key='email_enabled'");
console.log('  email switch               : ' + (sw ? sw.value + '  (set by ' + sw.updated_by + ' at ' + sw.updated_at + ')' : 'unset — defaults to ON'));

console.log('');
db.close();
