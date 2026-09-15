#!/usr/bin/env node
/**
 * fix-abdullatif-faour-accounts.js — untangle three crossed identities from
 * an earlier link-directory confirmation.
 *
 *   node scripts/fix-abdullatif-faour-accounts.js            # report only
 *   node scripts/fix-abdullatif-faour-accounts.js --apply    # write it
 *
 * WHAT HAPPENED
 * Two real AD accounts (m.faour@swd.bh, display name "Mohamad N. Faour", and
 * m.abdullatif@swd.bh, display name "Mohamed Abdullatif") got hand-confirmed
 * against the wrong roster entries:
 *
 *   AD account          wrongly confirmed as roster person
 *   m.faour              محمد عبداللطيف محمد   (مسجد dept)   — should be m.abdullatif
 *   m.abdullatif          محمد طلحه وحيد        (هندسية dept) — is not this person at all
 *
 * ...while the account that actually IS "Mohamad Nadeem Faour" (محمد نديم
 * فاعور, maintenance dept) was left unmatched — its own top AD candidate,
 * m.faour @0.83, sat right there in directory-link.csv but was never applied.
 *
 * THE FIX
 *   محمد عبداللطيف محمد   (mosques_guidance_dept) → username becomes m.abdullatif
 *   محمد نديم فاعور        (maintenance_dept)      → username becomes m.faour
 *   محمد طلحه وحيد         (engineering_services_dept) → username cleared (null)
 *
 * طلحه وحيد's real AD account is not known — this leaves him unmatched rather
 * than guess, same rule the rest of this pipeline already follows: a wrong
 * account is worse than none.
 *
 * Three stores, kept in sync the same way fix-directory-links.js does it:
 *   users table        — the two AD-account rows (ids found by username, not
 *                        hardcoded) get their roster data (name/dept/ext/mobile)
 *                        swapped; the username column itself never changes,
 *                        since that already matches the real AD account.
 *   directory.json     — the three roster entries' username fields.
 *   directory-link.csv — the audit trail, so a future run of
 *                        fix-directory-links.js does not read stale rows.
 *
 * Confirmed against real AD by SWD during this conversation (Faour's name and
 * email given directly), and against a live check that neither DB row has any
 * session, audit-log, or foreign-key activity yet — both are still exactly
 * what link-directory.js created, untouched since.
 *
 * Self-verifying like the rest of this family of scripts: every precondition
 * below is checked against whatever the files actually contain right now, and
 * the script refuses rather than guesses if reality has moved on.
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db } = require('../db');
const { readConfig } = require('../services/configService');

const APPLY    = process.argv.includes('--apply');
const CSV_PATH = path.join(__dirname, '..', 'data', 'directory-link.csv');
const DIR_PATH = path.join(__dirname, '..', 'config', 'directory.json');

const PLAN = [
  {
    deptId: 'mosques_guidance_dept', name: 'محمد عبداللطيف محمد',
    username: 'm.abdullatif', email: 'm.abdullatif@swd.bh', adName: 'Mohamed Abdullatif',
    ext: '5069', mobile: '35676906',
  },
  {
    deptId: 'maintenance_dept', name: 'محمد نديم فاعور',
    username: 'm.faour', email: 'm.faour@swd.bh', adName: 'Mohamad N. Faour',
    ext: null, mobile: '66333554',
  },
  {
    deptId: 'engineering_services_dept', name: 'محمد طلحه وحيد',
    username: null, email: '', adName: '',
    ext: '4006', mobile: '33104704',
  },
];

function lockedBy(file) {
  if (!fs.existsSync(file)) return null;
  try { fs.closeSync(fs.openSync(file, 'r+')); return null; }
  catch (e) { return e.code || 'EACCES'; }
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head  = lines.shift().split(',');
  return lines.map(line => {
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
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] || '').trim()]));
  });
}
const csvCell = v => {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main() {
  console.log('\n[fix] checking current state against what this script expects...\n');

  // ── Precondition 1: neither AD account is a head/deputy anywhere ─────────
  const cfg = readConfig();
  for (const dept of cfg.departments) {
    for (const slot of ['head', 'deputy']) {
      const u = dept[slot]?.username;
      if (u === 'm.faour' || u === 'm.abdullatif') {
        console.error(`  refusing — ${u} is ${slot} of ${dept.label}; this script does not touch departments.json.`);
        process.exit(1);
      }
    }
  }
  console.log('  OK — neither account is a department head/deputy.');

  // ── Precondition 2: the users table rows are exactly what we found earlier ─
  const faourRow      = db.prepare("SELECT * FROM users WHERE username = 'm.faour'").get();
  const abdullatifRow = db.prepare("SELECT * FROM users WHERE username = 'm.abdullatif'").get();

  if (!faourRow || !abdullatifRow) {
    console.error('  refusing — expected both m.faour and m.abdullatif to already exist in users. Nothing changed.');
    process.exit(1);
  }
  if (faourRow.full_name !== 'محمد عبداللطيف محمد' || abdullatifRow.full_name !== 'محمد طلحه وحيد') {
    console.error('  refusing — the names on these accounts do not match what this script expects.');
    console.error(`    m.faour       full_name = "${faourRow.full_name}" (expected محمد عبداللطيف محمد)`);
    console.error(`    m.abdullatif  full_name = "${abdullatifRow.full_name}" (expected محمد طلحه وحيد)`);
    console.error('  Someone may have already fixed this. Nothing written.');
    process.exit(1);
  }
  for (const [row, label] of [[faourRow, 'm.faour'], [abdullatifRow, 'm.abdullatif']]) {
    if (row.password_hash) {
      console.error(`  refusing — ${label} has a local password set, meaning a real person has been using this exact login. Not safe to repurpose automatically.`);
      process.exit(1);
    }
  }
  console.log('  OK — users table rows match: m.faour holds عبداللطيف\'s data, m.abdullatif holds طلحه وحيد\'s data. Neither has ever logged in.');

  // ── Precondition 3: no live activity on either account ───────────────────
  const ID_COLS   = ['user_id','from_user_id','to_user_id','sender_id','approver_id','assigned_to','assigned_by','owner_id','uploaded_by','actor_id','created_by_id','recipient_id','member_id'];
  const NAME_COLS = ['username','from_username','approver','actor'];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const hits = [];
  for (const t of tables) {
    if (t === 'users') continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    for (const c of cols) {
      const byId = ID_COLS.includes(c), byName = NAME_COLS.includes(c);
      if (!byId && !byName) continue;
      for (const [id, uname] of [[faourRow.id, 'm.faour'], [abdullatifRow.id, 'm.abdullatif']]) {
        try {
          const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = ?`).get(byId ? id : uname).n;
          if (n) hits.push(`${t}.${c} → ${uname} (${n})`);
        } catch { /* column type mismatch — not a reference */ }
      }
    }
  }
  if (hits.length) {
    console.error('  refusing — found real activity on one of these accounts, so swapping their data would misattribute it:');
    hits.forEach(h => console.error(`    ${h}`));
    process.exit(1);
  }
  console.log('  OK — no sessions, audit entries, or records reference either account yet.\n');

  // ── Report ─────────────────────────────────────────────────────────────
  console.log('  planned result:');
  console.log(`    m.faour        → محمد نديم فاعور   (maintenance_dept, mobile 66333554, no ext)`);
  console.log(`    m.abdullatif   → محمد عبداللطيف محمد (mosques_guidance_dept, ext 5069, mobile 35676906)`);
  console.log(`    محمد طلحه وحيد → left unmatched (engineering_services_dept keeps his name/ext/mobile; no account linked — his real AD account is unknown)\n`);

  if (!APPLY) {
    console.log('[fix] dry run — nothing written. Re-run with --apply to make these changes.\n');
    return;
  }

  // ── Preflight: refuse if a target file is locked ─────────────────────────
  const locks = [CSV_PATH, DIR_PATH].map(f => [f, lockedBy(f)]).filter(([, c]) => c);
  if (locks.length) {
    console.error('[fix] nothing written — a file is locked by another program:');
    locks.forEach(([f, code]) => console.error(`    ${path.basename(f)}  (${code})`));
    process.exit(1);
  }

  // ── Write: users table ────────────────────────────────────────────────
  const abdullatif = PLAN.find(p => p.username === 'm.abdullatif');
  const faour       = PLAN.find(p => p.username === 'm.faour');
  db.transaction(() => {
    db.prepare('UPDATE users SET full_name=?, dept_id=?, ext=?, mobile=? WHERE id=?')
      .run(abdullatif.name, abdullatif.deptId, abdullatif.ext, abdullatif.mobile, abdullatifRow.id);
    db.prepare('UPDATE users SET full_name=?, dept_id=?, ext=?, mobile=? WHERE id=?')
      .run(faour.name, faour.deptId, faour.ext, faour.mobile, faourRow.id);
  })();
  console.log('  users table updated.');

  // ── Write: directory.json ─────────────────────────────────────────────
  const dir = JSON.parse(fs.readFileSync(DIR_PATH, 'utf8'));
  let dirMatched = 0;
  for (const p of PLAN) {
    const people = dir.departments?.[p.deptId];
    const person = people?.find(x => x.name === p.name);
    if (!person) { console.warn(`  warning — could not find "${p.name}" under ${p.deptId} in directory.json`); continue; }
    person.username = p.username;
    dirMatched++;
  }
  fs.writeFileSync(DIR_PATH, JSON.stringify(dir, null, 2), 'utf8');
  console.log(`  directory.json updated (${dirMatched}/3 people matched).`);

  // ── Write: directory-link.csv (audit trail only) ──────────────────────
  try {
    const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    const head = Object.keys(rows[0]);
    let csvMatched = 0;
    for (const p of PLAN) {
      const row = rows.find(r => r.dept_id === p.deptId && r.arabic_name === p.name);
      if (!row) { console.warn(`  warning — could not find "${p.name}" (${p.deptId}) in directory-link.csv`); continue; }
      row.username    = p.username || '';
      row.email        = p.email || '';
      row.ad_name      = p.adName || '';
      row.confidence   = p.username ? '1.00' : '0.00';
      row.alternatives = p.username
        ? 'confirmed by hand'
        : 'unmatched — was wrongly linked to m.abdullatif; real AD account unknown';
      csvMatched++;
    }
    fs.writeFileSync(
      CSV_PATH,
      '﻿' + [head.join(',')].concat(rows.map(r => head.map(h => csvCell(r[h])).join(','))).join('\r\n'),
      'utf8'
    );
    console.log(`  directory-link.csv updated (${csvMatched}/3 rows matched).`);
  } catch (e) {
    console.warn(`  warning — could not update directory-link.csv: ${e.code || e.message}`);
    console.warn('            the database and directory.json were still updated.');
  }

  console.log(`
[fix] done
       m.faour and m.abdullatif now point at the right person.
       محمد طلحه وحيد is unmatched until his real AD account is identified.

       Restart the server so its config cache reloads.
`);
}

main();
