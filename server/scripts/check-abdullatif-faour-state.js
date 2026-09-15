#!/usr/bin/env node
// Read-only. Prints exactly what m.faour and m.abdullatif currently hold in
// the users table, plus whether either has a session or audit_log activity —
// the same facts fix-abdullatif-faour-accounts.js checks before writing,
// surfaced here without the pass/fail refusal so a drifted precondition can
// be seen and reasoned about instead of guessed at.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { db } = require('../db');

for (const username of ['m.faour', 'm.abdullatif']) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  console.log(`\n--- ${username} ---`);
  if (!row) { console.log('  (no row)'); continue; }
  console.log(`  id: ${row.id}`);
  console.log(`  full_name: "${row.full_name}"`);
  console.log(`  dept_id:   ${row.dept_id}`);
  console.log(`  ext:       ${row.ext}`);
  console.log(`  mobile:    ${row.mobile}`);
  console.log(`  email:     ${row.email}`);
  console.log(`  role:      ${row.role}`);
  console.log(`  has local password: ${row.password_hash ? 'YES' : 'no'}`);
  console.log(`  created_by: ${row.created_by}  created_at: ${row.created_at}`);

  const sessions = db.prepare('SELECT jti, created_at, expires_at, ip FROM sessions WHERE username = ?').all(username);
  console.log(`  sessions: ${sessions.length}`);
  sessions.forEach(s => console.log(`    ${s.created_at} → expires ${s.expires_at}  ip=${s.ip}`));

  const audit = db.prepare("SELECT id, action, created_at FROM audit_log WHERE actor_username = ? OR target_id = ? ORDER BY id DESC LIMIT 10").all(username, username);
  console.log(`  audit_log: ${audit.length}`);
  audit.forEach(a => console.log(`    #${a.id} ${a.created_at}  ${a.action}`));
}
console.log('');
