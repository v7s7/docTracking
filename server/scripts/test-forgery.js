// server/scripts/test-forgery.js
//
// What does this server accept from someone holding JWT_SECRET?
// Read-only: it mints tokens and makes GET requests, and changes nothing.
//
//   1. start a server on port 3399:   set PORT=3399 && node index.js
//   2. node scripts/test-forgery.js
const path = require('path');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));
const { db } = require(path.join(SERVER, 'db'));

const API = process.env.TEST_API || 'http://127.0.0.1:3399';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + m); c ? pass++ : fail++; };

const victim = db.prepare("SELECT id, username, full_name, dept_id FROM users WHERE is_active=1 AND dept_id='it_dept' LIMIT 1").get();
const sign = extra => jwt.sign(
  { id: victim.id, username: victim.username, name: victim.full_name, role: 'STAFF', dept_id: victim.dept_id, ...extra },
  process.env.JWT_SECRET, { expiresIn: '1h' });
const hit = async (token, p) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + token } })).status;

(async () => {
  console.log('target: ' + victim.username + ' (id ' + victim.id + ') via ' + API + '\n');

  console.log('— forged token naming a session that does not exist —');
  ok(await hit(sign({ jti: 'no-such-session' }), '/correspondence/stats') === 401, 'refused');

  console.log('\n— forged token with no jti claim at all —');
  // The session lookup used to sit behind `if (req.user.jti)`, so omitting the
  // claim skipped revocation entirely and the token was accepted as this user.
  const s = await hit(sign({}), '/correspondence/stats');
  ok(s === 401, 'refused (' + s + ')');

  console.log('\n— nothing privileged is reachable with it —');
  for (const p of ['/correspondence/stats', '/messages/conversations', '/admin/config', '/admin/email-switch', '/admin/role-map']) {
    const st = await hit(sign({}), p);
    ok(st !== 200, p + ' → ' + st);
  }

  db.close();
  console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' CHECKS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
  process.exit(fail ? 1 : 0);
})();
