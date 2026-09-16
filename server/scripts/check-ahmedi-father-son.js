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
  'a.ahmedi': { who: 'FATHER', full_name: 'ادم أحمد أحمدي',    email: 'a.ahmedi@swd.bh', dept_id: 'hr_dept',          ext: '5077', mobile: '33211217' },
  'a.aadam':  { who: 'SON',    full_name: 'عبدالله آدم أحمدي', email: 'a.aadam@swd.bh',  dept_id: 'investments_dept', ext: '4065', mobile: null },
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
  console.log(`  email:     ${mark('email')}`);
  console.log(`  dept_id:   ${mark('dept_id')}`);
  console.log(`  ext:       ${mark('ext')}`);
  console.log(`  mobile:    ${mark('mobile')}`);
  console.log(`  role:      ${row.role}   active: ${row.is_active}   local password: ${row.password_hash ? 'YES' : 'no'}`);

  // Work done in the system decides whether the fix may proceed; sign-in
  // history does not (the username is not changing). Reported separately so
  // the two are never read as one number.
  const count = (sql, p) => { try { return db.prepare(sql).get(p).n; } catch { return 0; } };
  const work = [
    ['correspondence',  count('SELECT COUNT(*) n FROM correspondences WHERE from_user_id = ?', row.id)],
    ['corr events',     count('SELECT COUNT(*) n FROM correspondence_events WHERE actor_id = ?', row.id)],
    ['chat messages',   count('SELECT COUNT(*) n FROM messages WHERE sender_id = ?', row.id)],
    ['conversations',   count('SELECT COUNT(*) n FROM conversation_members WHERE user_id = ?', row.id)],
    ['circular reads',  count('SELECT COUNT(*) n FROM circular_reads WHERE user_id = ?', row.id)],
  ].filter(([, n]) => n).map(([l, n]) => `${l}=${n}`);
  const traces = [
    ['sessions',      count('SELECT COUNT(*) n FROM sessions WHERE username = ?', username)],
    ['audit entries', count('SELECT COUNT(*) n FROM audit_log WHERE actor_username = ?', username)],
  ].filter(([, n]) => n).map(([l, n]) => `${l}=${n}`);
  console.log(`  work done: ${work.length ? work.join(', ') + '   <- the fix will REFUSE' : 'none'}`);
  console.log(`  sign-ins:  ${traces.length ? traces.join(', ') + '   (does not block the fix)' : 'none'}`);
}

// ── Anyone ELSE sharing these addresses? ──────────────────────────────────
// The son was found carrying his father's address. Worth knowing whether any
// other account is in the same state before calling this done.
console.log('\n--- accounts sharing an email address (whole system) ---');
const dups = db.prepare(`
  SELECT lower(email) email, GROUP_CONCAT(username, ', ') who, COUNT(*) n
    FROM users
   WHERE email IS NOT NULL AND trim(email) <> ''
   GROUP BY lower(email) HAVING COUNT(*) > 1
`).all();
if (!dups.length) console.log('  none');
dups.forEach(d => console.log(`  ${d.email}  ←  ${d.who}`));

// ── The directory rows these two were linked to ───────────────────────────
// Parsed the same way scripts/link-directory.js parses it. That tool quotes
// every field, so comparing raw comma-split text misses every row — which is
// exactly how an earlier version of this check printed only one of them.
function parseCsvLine(line) {
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

console.log('\n--- data/directory-link.csv ---');
try {
  const raw   = fs.readFileSync(path.join(__dirname, '..', 'data', 'directory-link.csv'), 'utf8');
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length);
  const head  = parseCsvLine(lines[0]).map(h => h.trim());
  let shown = 0;
  lines.slice(1).forEach(line => {
    const c = parseCsvLine(line);
    const r = Object.fromEntries(head.map((h, i) => [h, (c[i] || '').trim()]));
    // Match on ASCII only — usernames and the three extensions in play.
    if (['a.aadam', 'a.ahmedi'].includes(r.username) || ['5077', '5064', '4065'].includes(r.ext)) {
      console.log(`  ext=${r.ext.padEnd(5)} user=${(r.username || '(unlinked)').padEnd(11)} dept=${r.dept_id.padEnd(26)} name=${r.arabic_name}`);
      shown++;
    }
  });
  const quoted = lines.length > 1 && lines[1].startsWith('"');
  console.log(`  (${shown} matching row(s); file style: ${quoted ? 'every field quoted' : 'quoted only when needed'})`);
} catch (e) { console.log('  (could not read:', e.message + ')'); }

// ── Will auth.js undo a name fix? ─────────────────────────────────────────
// NOTE: this reads the FILE ON DISK. It cannot tell whether the running server
// has been restarted onto it — only the server's startup line can.
try {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const overwrites = /\.run\(\s*ldapUser\.name\s*,\s*ldapUser\.email/.test(src);
  console.log('\n--- routes/auth.js (file on disk) ---');
  console.log(overwrites
    ? '  OVERWRITES full_name from AD on every login — any Arabic name set here is temporary.'
    : '  keeps full_name once set. NOTE: this is the file, not the running process —');
  if (!overwrites) {
    console.log('  the server must have been RESTARTED and printed «Wasel (وصل) API running».');
  }
} catch { /* ignore */ }

console.log('');
