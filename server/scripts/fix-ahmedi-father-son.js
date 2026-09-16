#!/usr/bin/env node
/**
 * fix-ahmedi-father-son.js
 *
 *   node scripts/fix-ahmedi-father-son.js            # report only
 *   node scripts/fix-ahmedi-father-son.js --apply    # write it
 *
 * THE PROBLEM
 *
 * Two AD accounts, two different people — father and son, confirmed against
 * their Exchange contact cards:
 *
 *   a.ahmedi  → Display "Adam Ahmedi"           = ادم أحمد أحمدي     (FATHER)
 *   a.aadam   → Display "Abdulla Aadam Ahmedi"  = عبدالله آدم أحمدي  (SON)
 *
 * data/directory-link.csv linked both of them to the wrong phone-directory
 * rows, and both rows were marked `confidence 1.00, confirmed by hand` — so
 * the confidence score is no help here; a person approved these by eye and the
 * two Ahmedis were read as one.
 *
 * What that left in the users table:
 *
 *   a.aadam (SON)    holds his FATHER's name «ادم أحمد أحمدي», in hr_dept at
 *                    ext 5077 — the father's row.
 *   a.ahmedi (FATHER) holds «يوسف أحمد عيد أدم» — a THIRD employee entirely —
 *                    in engineering_services_dept at ext 5064.
 *
 * So it is not a straight swap: a third person's identity is in the middle of
 * it, and the son's own name appears in no directory row at all.
 *
 * THE FIX (each value confirmed with the system owner, not inferred)
 *
 *   a.ahmedi  → «ادم أحمد أحمدي»,     hr_dept,          ext 5077, mob 33211217
 *   a.aadam   → «عبدالله آدم أحمدي», investments_dept, ext 4065, mob CLEARED
 *
 * The son's mobile is cleared rather than kept: the 33211217 on his record came
 * from his father's HR directory row, so it is almost certainly his father's
 * number. A blank mobile in دليل الهاتف is honest; a wrong one sends calls to
 * the wrong man — and these two share a surname, which is exactly how such a
 * mistake survives unnoticed.
 *
 * يوسف أحمد عيد أدم is a real third employee in المشاريع والخدمات الهندسية with
 * no AD account. This script does NOT invent one. His directory row is unlinked
 * by unlink-yusuf-directory-row (see below) so he stops being conflated with
 * the father, and he joins the other unlinked engineering entries (محمد نسيم
 * موزني, عبدالعزيز السويدي) waiting for an account. His extension and mobile
 * are UNVERIFIED — the owner was explicit about that — so nothing here asserts
 * them.
 *
 * SAFE TO RUN
 * Neither account had done any WORK when this was written: no correspondence,
 * no correspondence_events, no notifications, no chat messages, no conversation
 * memberships, no circular_reads. There is nothing to re-point and nothing to
 * orphan — unlike the m.faour case, which needed its notification artifacts
 * cleared first.
 *
 * It re-checks that before writing and refuses if either has since done work.
 * Sign-in history (sessions, USER_LOGIN audit rows) does NOT refuse: on
 * production a.ahmedi has already signed in, and none of that is keyed on
 * anything this script changes.
 *
 * NOTE ON auth.js
 * Until the companion change to routes/auth.js ships, every LDAP login
 * OVERWRITES full_name from the AD display name — which would undo the Arabic
 * names below the next time either man signs in. That change keeps full_name
 * once set and syncs only email. Run this AFTER deploying it, or the fix is
 * temporary. The script warns if it detects the old behaviour still in place.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs   = require('fs');
const path = require('path');
const { db } = require('../db');

const APPLY = process.argv.includes('--apply');

// username → what the row must become. Every value confirmed with the owner.
//
// email is here because production showed a problem the development copy could
// not: a.aadam — the SON — carried a.ahmedi@swd.bh, his FATHER's address. Two
// accounts shared one mailbox, so every notification meant for the son landed in
// his father's inbox. The son's Exchange card reads SMTP:a.aadam@swd.bh.
const TARGET = {
  'a.ahmedi': {
    who:       'FATHER',
    full_name: 'ادم أحمد أحمدي',
    email:     'a.ahmedi@swd.bh',
    dept_id:   'hr_dept',
    ext:       '5077',
    mobile:    '33211217',
  },
  'a.aadam': {
    who:       'SON',
    full_name: 'عبدالله آدم أحمدي',
    email:     'a.aadam@swd.bh',
    dept_id:   'investments_dept',
    ext:       '4065',
    mobile:    null,          // deliberately cleared — see header
  },
};

// WORK done in the system under this account. Any of it means a person has been
// operating inside the wrong department, and that deserves a human look before
// the department moves under them. Refuses if any is non-zero.
const WORK = [
  ['correspondence sent',      'SELECT COUNT(*) n FROM correspondences WHERE from_user_id = ?',            'id'],
  ['correspondence events',    'SELECT COUNT(*) n FROM correspondence_events WHERE actor_id = ?',          'id'],
  ['corr notifications',       'SELECT COUNT(*) n FROM correspondence_notifications WHERE user_id = ?',    'id'],
  ['chat messages',            'SELECT COUNT(*) n FROM messages WHERE sender_id = ?',                      'id'],
  ['conversation memberships', 'SELECT COUNT(*) n FROM conversation_members WHERE user_id = ?',            'id'],
  ['circular reads',           'SELECT COUNT(*) n FROM circular_reads WHERE user_id = ?',                  'id'],
];

// SIGN-IN traces. Reported, never blocking.
//
// An earlier version of this script counted these as attached data and would
// have refused on production: a.ahmedi HAS signed in there — that sign-in is
// exactly what replaced his Arabic name with "Adam Ahmedi" — so he has sessions
// and USER_LOGIN audit rows. None of them is affected by this fix: both are
// keyed on the username, and the username does not change here. Only full_name,
// dept_id, ext and mobile do. The local copy had no sign-ins, so the dry run
// passed there and hid the problem entirely.
const TRACES = [
  ['sessions',      'SELECT COUNT(*) n FROM sessions WHERE username = ?',     'username'],
  ['audit entries', 'SELECT COUNT(*) n FROM audit_log WHERE actor_username = ?', 'username'],
];

function countsOf(row, list) {
  const found = [];
  for (const [label, sql, key] of list) {
    let n = 0;
    try { n = db.prepare(sql).get(row[key]).n; } catch { continue; }   // table may not exist
    if (n) found.push(`${label}=${n}`);
  }
  return found;
}

// ── directory-link.csv, read the way the project's own tools read it ──────
//
// parseCsvLine is the parser from scripts/link-directory.js and
// scripts/fix-directory-links.js, copied because neither exports it. The copy is
// exact on purpose, because those two tools WRITE the file differently:
//
//   link-directory.js       quotes every field      "hr_dept","ادم أحمد أحمدي","a.aadam"
//   fix-directory-links.js  quotes only when needed  hr_dept,ادم أحمد أحمدي,a.aadam
//
// Production holds the first form; the development copy had been re-saved in
// the second. An earlier version of this script split on commas and compared
// raw text — right on the development copy, silently wrong on production. No
// row matched, so يوسف stayed linked to the father; and because "is the son
// already listed?" failed the same way, a DUPLICATE a.aadam row was appended —
// all while the script printed "1 row(s) corrected".
//
// Rows are matched on username AND extension, never on the Arabic name. Both are
// plain ASCII, so a hamza written another way, a tatweel or an invisible joiner
// in the name cannot make a row quietly fail to match.
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

function correctDirectoryCsv(raw) {
  const bom   = raw.startsWith('﻿') ? '﻿' : '';
  const eol   = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length);
  const head  = parseCsvLine(lines[0]).map(h => h.trim());
  const rows  = lines.slice(1).map(l => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] || '').trim()]));
  });

  // Write back in the style the file already uses, so the diff is the rows that
  // changed rather than every line re-quoted. Both tools write the header bare.
  const allQuoted = lines.length > 1 && lines[1].startsWith('"');
  const cell = v => {
    const s = String(v ?? '');
    return (allQuoted || /[",\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  let touched = 0;
  for (const r of rows) {
    if (r.username === 'a.aadam' && r.ext === '5077') {
      // Father's HR row. Its name, ext and mobile were right — only the AD link.
      Object.assign(r, {
        username: 'a.ahmedi', email: 'a.ahmedi@swd.bh', ad_name: 'Adam Ahmedi',
        alternatives: 'corrected: father — was wrongly linked to his son a.aadam',
      });
      touched++;
    } else if (r.username === 'a.ahmedi' && r.ext === '5064') {
      // يوسف: a real employee with no AD account. Unlinked, not deleted.
      Object.assign(r, {
        username: '', email: '', ad_name: '', confidence: '',
        alternatives: 'unlinked: real employee, no AD account; ext/mobile UNVERIFIED',
      });
      touched++;
    }
  }

  // The son had no row of his own. Checked AFTER the loop, because until the
  // father's row is re-linked it is the one still wearing a.aadam.
  if (!rows.some(r => r.username === 'a.aadam')) {
    const son = Object.fromEntries(head.map(h => [h, '']));
    Object.assign(son, {
      dept_id: 'investments_dept', dept_label: 'قسم الاستثمارات الوقفية', rank: 'staff', role: 'STAFF',
      arabic_name: 'عبدالله آدم أحمدي', ext: '4065', mobile: '',
      username: 'a.aadam', email: 'a.aadam@swd.bh', ad_name: 'Abdulla Aadam Ahmedi',
      confidence: '1.00', alternatives: 'added: son of ادم أحمد أحمدي — mobile unknown',
    });
    const at = rows.findIndex(r => r.dept_id === 'investments_dept');
    rows.splice(at >= 0 ? at : rows.length, 0, son);
    touched++;
  }

  const text = bom + [head.join(','), ...rows.map(r => head.map(h => cell(r[h])).join(','))].join(eol);
  return { text, touched, rows };
}

// ── Warn if auth.js will undo this ────────────────────────────────────────
// Matches the old EXECUTABLE call, not the SQL text. The new auth.js quotes the
// retired statement in a comment explaining why it went, so searching for the
// SQL string reports a fixed file as still broken.
function authStillOverwritesNames() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    return /\.run\(\s*ldapUser\.name\s*,\s*ldapUser\.email/.test(src);
  } catch { return false; }
}

console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===');

if (authStillOverwritesNames()) {
  console.log('');
  console.log('  !! routes/auth.js still overwrites full_name from Active Directory on every');
  console.log('     login. The Arabic names below will be replaced with the Latin AD display');
  console.log('     names the next time either man signs in. Deploy the auth.js change first.');
}

let blocked = false;
const plan = [];

for (const [username, want] of Object.entries(TARGET)) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  console.log(`\n--- ${username}  (${want.who}) ---`);

  if (!row) {
    console.log('  !! no such row — REFUSING, production has drifted from what this expects');
    blocked = true;
    continue;
  }

  const traces = countsOf(row, TRACES);
  if (traces.length) {
    console.log(`  signed in before (${traces.join(', ')}) — fine, the username is not changing`);
  }

  const work = countsOf(row, WORK);
  if (work.length) {
    console.log(`  !! has done work in the system (${work.join(', ')}) — REFUSING.`);
    console.log('     He has been operating inside the wrong department. Look at what he sent');
    console.log('     and who he talked to before moving the department out from under him.');
    blocked = true;
    continue;
  }

  const changes = [];
  for (const field of ['full_name', 'email', 'dept_id', 'ext', 'mobile']) {
    const from = row[field] ?? null;
    const to   = want[field] ?? null;
    const same = String(from ?? '') === String(to ?? '');
    console.log(`  ${field.padEnd(10)} ${same ? '=' : '→'} ${same ? `"${from ?? ''}" (already correct)`
                                                                  : `"${from ?? ''}"  →  "${to ?? ''}"`}`);
    if (!same) changes.push([field, to]);
  }

  // Moving an address onto this account must not create the same problem it is
  // fixing somewhere else. Two accounts sharing a mailbox is exactly how the son
  // came to receive nothing and the father everything twice.
  const emailChange = changes.find(([f]) => f === 'email');
  if (emailChange) {
    const holder = db.prepare(
      'SELECT username FROM users WHERE lower(email) = lower(?) AND id <> ?'
    ).get(emailChange[1], row.id);
    if (holder && !(holder.username in TARGET)) {
      console.log(`  !! ${emailChange[1]} already belongs to ${holder.username} — REFUSING.`);
      blocked = true;
      continue;
    }
  }

  if (!changes.length) console.log('  nothing to change.');
  else plan.push({ id: row.id, username, changes });
}

console.log('');

if (blocked) {
  console.log('REFUSED — nothing written. Resolve the warnings above first.');
  process.exit(1);
}
if (!plan.length) {
  console.log('Nothing to do — both accounts already hold the correct values.');
  process.exit(0);
}
if (!APPLY) {
  console.log(`Would update ${plan.length} account(s). Re-run with --apply to write.`);
  process.exit(0);
}

const write = db.transaction(() => {
  for (const { id, username, changes } of plan) {
    for (const [field, value] of changes) {
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, id);
    }
    console.log(`  updated ${username}: ${changes.map(([f]) => f).join(', ')}`);
  }
});
write();

// ── data/directory-link.csv ───────────────────────────────────────────────
// Corrected here, not shipped through git: server/data/ is gitignored, so the
// fixed CSV on the development machine never reaches production.
//
// This is not tidying. scripts/link-directory.js --apply writes full_name and
// dept_id straight from this file, so a crossed CSV left on the server would
// silently re-cross both men the next time anyone re-runs the linker — undoing
// every change above with no error to say so.
//
// Idempotent: each row is only rewritten while it still holds the wrong link.
try {
  const csvPath = path.join(__dirname, '..', 'data', 'directory-link.csv');
  const result  = correctDirectoryCsv(fs.readFileSync(csvPath, 'utf8'));

  if (result.touched) {
    fs.copyFileSync(csvPath, csvPath + '.before-ahmedi-fix');
    fs.writeFileSync(csvPath, result.text, 'utf8');
    console.log(`  directory-link.csv: ${result.touched} row(s) corrected (backup: directory-link.csv.before-ahmedi-fix)`);
  } else {
    console.log('  directory-link.csv: already correct');
  }
} catch (e) {
  // Not fatal — the accounts are already fixed — but loud, because a crossed
  // CSV is a loaded gun for the next linker run.
  console.log(`  !! could not correct directory-link.csv: ${e.message}`);
  console.log('     Do NOT run link-directory.js --apply until it is fixed by hand.');
}

console.log('');
console.log('Done. Verify with:  node scripts/check-ahmedi-father-son.js');
