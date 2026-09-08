// server/scripts/test-escalation.js
//
// Four ways a user could reach مدير النظام without being granted it. All four
// were real and are now closed; this is the regression guard.
//
// It WRITES (it promotes an account to prove the guard holds), so it refuses to
// run against the live database. Point a server at a throwaway copy first:
//
//   copy data\doctracking.db %TEMP%\esc.db
//   set DB_PATH=%TEMP%\esc.db && set PORT=3399 && node index.js
//   set DB_PATH=%TEMP%\esc.db && node scripts/test-escalation.js
const path = require('path');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));

const DBC = process.env.DB_PATH;
if (!DBC || path.basename(DBC).toLowerCase() === 'doctracking.db') {
  console.error('REFUSING TO RUN: set DB_PATH to a COPY of the database, not the live one.');
  console.error('This script promotes an account to prove the guard holds.');
  process.exit(2);
}
const db = require(path.join(SERVER, 'node_modules', 'better-sqlite3'))(DBC);
const SECRET = process.env.JWT_SECRET;
const API = process.env.TEST_API || 'http://127.0.0.1:3399';
const ADMIN = '/admin/config';                       // requireRole('SUPER_ADMIN')

let pass = 0, fail = 0;
const ok = (c, m) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + m); c ? pass++ : fail++; };
const sess = u => {
  const jti = 'esc-' + process.pid + '-' + Math.floor(Math.random() * 1e6);
  db.prepare('INSERT OR REPLACE INTO sessions (jti,username,full_name,role,ip,user_agent,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(jti, u.username, u.full_name, u.role, '127.0.0.1', 'test', new Date(Date.now() + 6e5).toISOString());
  return jti;
};
const call = async (tok, p, opts = {}) => {
  const r = await fetch(API + p, { ...opts, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, body: b };
};


async function reachable(api) {
  try { await fetch(api + it_is_up_probe); return true; }
  catch (e) {
    console.error("");
    console.error("  THE SERVER IS NOT RUNNING at " + api);
    console.error("  (" + ((e && e.cause && e.cause.code) || e.message) + ")");
    console.error("");
    console.error("  Start it from the server folder with:  npm start");
    console.error("  If it IS running, it is on another port: set TEST_API=http://127.0.0.1:<port>");
    console.error("");
    return false;
  }
}
const it_is_up_probe = "/auth/me";
(async () => {
  if (!await reachable(API)) { db.close(); process.exit(3); }
  const hr = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id='hr_dept' AND is_active=1 AND role='STAFF' LIMIT 1").get();

  // The server must be reading the SAME copy this script writes to, or every
  // session it creates is invisible and all four checks 401 for the wrong
  // reason — which reads exactly like a regression. Prove a legitimate token
  // works before concluding anything from one being refused.
  const probe = jwt.sign({ id: hr.id, username: hr.username, name: hr.full_name, role: hr.role, dept_id: hr.dept_id, jti: sess(hr) }, SECRET, { expiresIn: '10m' });
  const pre = await call(probe, '/correspondence/stats');
  if (pre.status === 401) {
    console.error('');
    console.error('  The server is NOT using this database.');
    console.error('  A valid session written to ' + DBC + ' was refused, so the');
    console.error('  server is reading a different file. Start it with the same DB_PATH:');
    console.error('');
    console.error('     set DB_PATH=' + DBC + ' && set PORT=3399 && node index.js');
    console.error('');
    db.close(); process.exit(4);
  }
  const it = db.prepare("SELECT id,username,full_name,role,dept_id FROM users WHERE dept_id='it_dept' AND is_active=1 LIMIT 1").get();
  console.log('using ' + hr.username + ' (HR staff) against ' + API + '\n');

  // 1. A department change is a promotion: effectiveRole() grants مدير النظام by
  //    department, and refuseEdit only ever gated patch.role.
  console.log('— HR staff cannot promote themselves via dept_id —');
  const hrTok = jwt.sign({ id: hr.id, username: hr.username, name: hr.full_name, role: hr.role, dept_id: hr.dept_id, jti: sess(hr) }, SECRET, { expiresIn: '10m' });
  ok((await call(hrTok, ADMIN)).status === 403, 'ordinary HR staff refused the admin route');
  ok((await call(hrTok, '/users/' + hr.id, { method: 'PUT', body: JSON.stringify({ dept_id: 'it_dept' }) })).status === 403, 'moving own row into it_dept refused');
  ok((await call(hrTok, ADMIN)).status !== 200, 'still not an admin afterwards');

  // 2. The refresh block sat behind `if (req.user.id)`, so omitting id skipped
  //    both is_active and the role recomputation.
  console.log('\n— a token with no id does not keep its claimed role —');
  const noId = jwt.sign({ username: hr.username, name: hr.full_name, role: 'SUPER_ADMIN', dept_id: 'hr_dept', jti: sess(hr) }, SECRET, { expiresIn: '10m' });
  ok((await call(noId, ADMIN)).status !== 200, 'claimed SUPER_ADMIN not honoured');

  // 3. The jti was looked up alone, never against whose session it is.
  console.log('\n— a real session id cannot be reused under another name —');
  const swapped = jwt.sign({ id: it.id, username: it.username, name: it.full_name, role: it.role, dept_id: it.dept_id, jti: sess(hr) }, SECRET, { expiresIn: '10m' });
  ok((await call(swapped, ADMIN)).status === 401, "another user's session id refused");

  // 4. effectiveRole() was fed token-supplied username/email, and the
  //    SUPER_ADMIN_USERS override is keyed on exactly those.
  console.log('\n— the admin override cannot be claimed by the token —');
  const named = jwt.sign({ id: hr.id, username: 'a.alkubaesy', name: hr.full_name, role: 'STAFF', dept_id: 'hr_dept', jti: sess(hr) }, SECRET, { expiresIn: '10m' });
  ok((await call(named, ADMIN)).status !== 200, 'naming an override account in the payload does nothing');

  db.close();
  console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' CHECKS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
  process.exit(fail ? 1 : 0);
})();
