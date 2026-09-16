#!/usr/bin/env node
// Read-only. Prints exactly what a.ahmedi and a.aadam currently hold, plus the
// phone-directory rows they were linked to and whether either account has been
// used — the same facts fix-ahmedi-father-son.js checks before writing, without
// the refusal, so a drifted precondition can be looked at instead of guessed at.
//
// a.ahmedi is the FATHER (AD "Adam Ahmedi"), a.aadam is the SON (AD "Abdulla
// Aadam Ahmedi"). Both were linked to the wrong directory rows.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs   = require('fs');
const path = require('path');
const { db } = require('../db');

const EXPECTED = {
  'a.ahmedi': { who: 'FATHER', full_name: 'ادم أحمد أحمدي',    dept_id: 'hr_dept',          ext: '5077', mobile: '33211217' },
  'a.aadam':  { who: 'SON',    full_name: 'عبدالله آدم أحمدي', dept_id: 'investments_dept', ext: '4065', mobile: null },
};

for (const [username, want] of Object.entries(EXPECTED)) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  console.log(`\n--- ${username}  (${want.who}) ---`);
  if (!row) { console.log('  (no row)'); continue; }

  const mark = (field) => {
    const from = row[field] ?? null;
    const to   = want[field] ?? null;
    const ok   = String(from ?? '') === String(to ?? '');
    return `${String(from ?? '(blank)').padEnd(24)} ${ok ? 'OK' : `WRONG — expected "${to ?? '(blank)'}"`}`;
  };

  console.log(`  id:        ${row.id}`);
  console.log(`  full_name: ${mark('full_name')}`);
  console.log(`  dept_id:   ${mark('dept_id')}`);
  console.log(`  ext:       ${mark('ext')}`);
  console.log(`  mobile:    ${mark('mobile')}`);
  console.log(`  email:     ${row.email || '(blank)'}`);
  console.log(`  role:      ${row.role}   active: ${row.is_active}   local password: ${row.password_hash ? 'YES' : 'no'}`);

  // Has anyone actually used this account? Decides whether a rename is safe.
  const counts = [
    ['correspondence', 'SELECT COUNT(*) n FROM correspondences WHERE from_user_id = ?', row.id],
    ['chat messages',  'SELECT COUNT(*) n FROM messages WHERE sender_id = ?',           row.id],
    ['circular reads', 'SELECT COUNT(*) n FROM circular_reads WHERE user_id = ?',       row.id],
    ['sessions',       'SELECT COUNT(*) n FROM sessions WHERE username = ?',            username],
    ['audit entries',  'SELECT COUNT(*) n FROM audit_log WHERE actor_username = ?',     username],
  ];
  const used = counts.map(([label, sql, p]) => {
    let n = 0; try { n = db.prepare(sql).get(p).n; } catch { return null; }
    return n ? `${label}=${n}` : null;
  }).filter(Boolean);
  console.log(`  used:      ${used.length ? used.join(', ') : 'never — no activity of any kind'}`);
}

// ── The directory rows these two were linked to ───────────────────────────
console.log('\n--- data/directory-link.csv ---');
try {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'data', 'directory-link.csv'), 'utf8');
  csv.split(/\r?\n/).forEach(line => {
    const f = line.split(',');
    if (f[7] === 'a.aadam' || f[7] === 'a.ahmedi' || /يوسف أحمد عيد أدم/.test(line)) {
      console.log(`  dept=${f[0]}  name="${f[4]}"  ext=${f[5]}  user=${f[7] || '(unlinked)'}  ad="${f[9] || ''}"`);
    }
  });
} catch (e) { console.log('  (could not read:', e.message + ')'); }

// ── Will auth.js undo a name fix? ─────────────────────────────────────────
try {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  // The old executable call, not the SQL text — auth.js now quotes the retired
  // statement in a comment, which a search for the SQL string would match.
  const overwrites = /\.run\(\s*ldapUser\.name\s*,\s*ldapUser\.email/.test(src);
  console.log(`\n--- routes/auth.js ---`);
  console.log(overwrites
    ? '  OVERWRITES full_name from AD on every login — any Arabic name set here is temporary.'
    : '  keeps full_name once set; syncs email only. Name fixes will survive login.');
} catch { /* ignore */ }

console.log('');
