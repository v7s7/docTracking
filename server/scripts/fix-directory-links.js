#!/usr/bin/env node
/**
 * fix-directory-links.js — repair links written by an earlier link-directory run.
 *
 *   node scripts/fix-directory-links.js            # report only, changes nothing
 *   node scripts/fix-directory-links.js --apply    # write the fixes
 *
 * TWO KINDS OF REPAIR
 *
 * 1. AUTOMATIC — one person, two departments.
 *    link-directory.js used to reserve each AD account for the first person who
 *    matched it. That is right for two different people with similar names, and
 *    wrong for one person holding a post in two departments: the second post got
 *    handed the runner-up match — a different employee's account — or nothing.
 *    This regroups every head/deputy post by Arabic name and gives all of a
 *    person's posts their own best-matching account.
 *
 * 2. MANUAL — decisions no matching algorithm can make, confirmed by SWD.
 *    Listed in MANUAL below, each with the reason it is there.
 *
 * Idempotent: running it twice changes nothing the second time. Safe to run on a
 * half-applied state — every write is an upsert.
 *
 * WRITE ORDER
 * The database is written first, then departments.json, then the CSV. The CSV is
 * an audit artifact, so a failure there (Excel holds a lock on it) is a warning,
 * not a crash — and every target is checked for writability before anything is
 * written, so a locked file stops the run before it starts rather than halfway
 * through.
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db } = require('../db');
const { readConfig, writeConfig } = require('../services/configService');

const APPLY     = process.argv.includes('--apply');
const CSV_PATH  = path.join(__dirname, '..', 'data', 'directory-link.csv');
const CFG_PATH  = path.join(__dirname, '..', 'config', 'departments.json');
const DIR_PATH  = path.join(__dirname, '..', 'config', 'directory.json');

// ── Decisions SWD confirmed by hand ───────────────────────────────────────
// `username: null` means "this post has no account" — the person stays listed
// as رئيس القسم / النائب, but nobody can approve as them until an account is
// assigned. That is deliberate: a wrong account is worse than none.
const MANUAL = [
  {
    dept: 'director_general_office', rank: 'head',
    name: 'أحمد خيري', username: 'khairi', ad_name: 'Ahmed Khairi',
    why: 'the roster listed the post as the title "المديرالعام", so there was '
       + 'no name to match. (a.khairi is عبدالله فؤاد خيري in تقنية المعلومات.)',
  },
  {
    dept: 'hr_dept', rank: 'deputy',
    name: 'الشيخ عطية الله آل خليفة', username: 'Ateyatalla.alkhalifa', ad_name: 'Ateyatalla Alkhalifa',
    why: 'that AD account carries no display name, so it scored 0.69 — just '
       + 'under the 0.72 cut-off — and the post was left unlinked.',
  },
  {
    dept: 'admin_affairs_dept', rank: 'deputy',
    name: 'الشيخ عطية الله آل خليفة', username: 'Ateyatalla.alkhalifa', ad_name: 'Ateyatalla Alkhalifa',
    why: 'same person, second post.',
  },
  {
    dept: 'mosques_guidance_dept', rank: 'deputy',
    name: 'عمار حسن طيب', username: null,
    why: 'the run matched him to omran.t at 0.83 on the surname alone. That '
       + 'account is out of service and belongs to someone else — عمران, not عمار.',
  },
];

// ── CSV ───────────────────────────────────────────────────────────────────
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

// Which person in directory.json a CSV row refers to. By name, because the CSV
// is the thing that gets hand-edited; by position for head/deputy, so a row whose
// name was corrected still finds its slot.
function personFor(dir, row) {
  const people = dir.departments?.[row.dept_id];
  if (!people) return null;
  return people.find(p => p.name === row.arabic_name)
    || (row.rank === 'head' ? people[0] : row.rank === 'deputy' ? people[1] : null)
    || null;
}

// Opening r+ is the only reliable way to see a Windows lock — fs.accessSync
// reports the file writable even while Excel holds it open.
function lockedBy(file) {
  if (!fs.existsSync(file)) return null;
  try { fs.closeSync(fs.openSync(file, 'r+')); return null; }
  catch (e) { return e.code || 'EACCES'; }
}

// ── Does anything in the database point at this user? ─────────────────────
// Generic on purpose: a column added later should block the delete too, not
// slip past a hardcoded list.
const ID_COLS = new Set([
  'user_id', 'from_user_id', 'to_user_id', 'sender_id', 'approver_id',
  'assigned_to', 'assigned_by', 'owner_id', 'uploaded_by', 'actor_id',
  'created_by_id', 'recipient_id', 'member_id',
]);
const NAME_COLS = new Set(['username', 'from_username', 'approver', 'actor']);

function referencesTo(id, username) {
  const hits = [];
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(r => r.name);

  for (const t of tables) {
    if (t === 'users') continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    for (const c of cols) {
      const byId   = ID_COLS.has(c);
      const byName = NAME_COLS.has(c);
      if (!byId && !byName) continue;
      try {
        const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = ?`)
          .get(byId ? id : username).n;
        if (n) hits.push(`${t}.${c} (${n})`);
      } catch { /* column type mismatch — not a reference */ }
    }
  }
  return hits;
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[fix] ${CSV_PATH} not found — nothing to repair.`);
    process.exit(1);
  }
  const rows  = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const cfg   = readConfig();
  const label = Object.fromEntries(cfg.departments.map(d => [d.id, d.label]));
  const at = (deptId, rank) => rows.find(r => r.dept_id === deptId && r.rank === rank);

  const changes = [];   // { row, name, from, to, fromConf, toConf, why }

  // 1. Manual decisions first — they are the ground truth the automatic pass
  //    below reconciles around.
  for (const m of MANUAL) {
    const row = at(m.dept, m.rank);
    if (!row) { console.warn(`  skip — no "${m.rank}" row for ${m.dept} in the CSV`); continue; }
    const nameChanged = m.name && row.arabic_name !== m.name;
    if (row.username === (m.username || '') && !nameChanged) continue;   // already right
    changes.push({
      row, name: m.name || row.arabic_name,
      from: row.username || '(none)', to: m.username || null,
      fromConf: row.confidence, toConf: m.username ? 'confirmed' : '—',
      adName: m.ad_name || '', why: m.why, manual: true,
    });
  }

  // 2. One account per person, across every post they hold.
  const leaders = rows.filter(r => r.rank === 'head' || r.rank === 'deputy');
  const pending = new Map(changes.map(c => [c.row, c.to]));
  const nameOf  = r => (changes.find(c => c.row === r) || {}).name || r.arabic_name;
  const userOf  = r => (pending.has(r) ? pending.get(r) : r.username) || '';

  const byPerson = new Map();
  for (const r of leaders) {
    const n = nameOf(r);
    if (!n) continue;
    if (!byPerson.has(n)) byPerson.set(n, []);
    byPerson.get(n).push(r);
  }

  for (const [name, posts] of byPerson) {
    if (posts.length < 2) continue;                       // one post — nothing to reconcile
    // A manual decision wins outright, including a deliberate unlink.
    const decided = posts.find(p => changes.some(c => c.row === p && c.manual));
    const best = decided
      ? { username: userOf(decided), confidence: 'confirmed' }
      : posts.filter(p => userOf(p))
             .map(p => ({ username: userOf(p), confidence: p.confidence }))
             .sort((a, b) => Number(b.confidence) - Number(a.confidence))[0];
    if (!best || !best.username) continue;                // no match anywhere — needs a human
    for (const p of posts) {
      if (userOf(p) === best.username) continue;
      if (changes.some(c => c.row === p)) continue;       // already decided by hand
      changes.push({
        row: p, name,
        from: p.username || '(none)', to: best.username,
        fromConf: p.confidence, toConf: best.confidence,
        why: 'the same person holds this post — their account was reserved by the other one.',
      });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log(`\n[fix] ${byPerson.size} people hold a head/deputy post`);
  console.log(`[fix] ${[...byPerson.values()].filter(p => p.length > 1).length} of them hold more than one\n`);

  if (!changes.length) {
    console.log('  nothing to reconcile — every post already points at the right account\n');
  } else {
    for (const c of changes) {
      console.log(`    ${label[c.row.dept_id] || c.row.dept_id}  (${c.row.rank})${c.manual ? '   [confirmed by hand]' : ''}`);
      console.log(`      ${c.name}`);
      console.log(`      ${c.from} @${c.fromConf}  →  ${c.to || '(no account)'} @${c.toConf}`);
      console.log(`      ${c.why}\n`);
    }
  }

  // 3. Accounts the earlier run created that nobody claims any more.
  const finalName = new Map(rows.map(r => [r, r.username]));
  for (const c of changes) finalName.set(c.row, c.to || '');
  const claimed = new Set([...finalName.values()].filter(Boolean));

  const orphans = db.prepare(
    "SELECT id, username, full_name, role, dept_id FROM users WHERE created_by = 'link-directory' AND password_hash IS NULL"
  ).all().filter(u => !claimed.has(u.username));

  const deletable = [];
  if (orphans.length) {
    console.log('  accounts created by the earlier run that nobody claims now:\n');
    for (const u of orphans) {
      const refs = referencesTo(u.id, u.username);
      console.log(`    ${u.username}  "${u.full_name}"  ${u.role}  ${u.dept_id}`);
      if (refs.length) console.log(`      KEEP — referenced by ${refs.join(', ')}`);
      else { console.log('      delete — nothing refers to it; LDAP recreates it on next login'); deletable.push(u); }
      console.log();
    }
  }

  // 4. Links not yet saved into directory.json.
  // This is a sync, not a repair: it runs even when there is nothing to
  // reconcile. server/data/ is gitignored, so directory.json is the only file
  // that carries the link to the server — if it is behind, the deploy pass there
  // rebuilds only part of the user list.
  let dirDoc = null, pendingLinks = 0;
  try {
    dirDoc = JSON.parse(fs.readFileSync(DIR_PATH, 'utf8'));
    for (const r of rows) {
      const person = personFor(dirDoc, r);
      if (person && (person.username || null) !== (r.username || null)) pendingLinks++;
    }
  } catch (e) {
    console.warn(`  warning — could not read directory.json: ${e.message}\n`);
  }
  if (pendingLinks) {
    console.log(`  ${pendingLinks} links are not yet saved into config/directory.json`);
    console.log('  — that file is what carries the link to the server, since server/data/ is gitignored.\n');
  }

  if (!APPLY) {
    console.log('[fix] dry run — nothing written. Re-run with --apply to make these changes.\n');
    return;
  }
  if (!changes.length && !deletable.length && !pendingLinks) {
    console.log('[fix] nothing to do — database, departments.json and directory.json all agree.\n');
    return;
  }

  // ── Preflight: refuse to start if a target is locked ─────────────────────
  const locks = [CSV_PATH, CFG_PATH, DIR_PATH].map(f => [f, lockedBy(f)]).filter(([, c]) => c);
  if (locks.length) {
    console.error('[fix] nothing written — a file is locked by another program:\n');
    for (const [f, code] of locks) console.error(`    ${path.basename(f)}  (${code})`);
    console.error('\n  Close it (Excel keeps a lock on an open CSV) and run again.\n');
    process.exit(1);
  }

  // ── Write: database, then config, then the audit trail ───────────────────
  const adName = new Map();
  for (const r of rows) if (r.username && r.ad_name && !adName.has(r.username)) adName.set(r.username, r.ad_name);
  for (const c of changes) if (c.adName && c.to) adName.set(c.to, c.adName);

  db.transaction(() => {
    for (const c of changes) {
      if (!c.to) continue;
      const existing = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(c.to);
      if (existing) {
        if (existing.password_hash) { console.warn(`  skip user row — "${c.to}" is a local account, not AD`); continue; }
        db.prepare('UPDATE users SET full_name=?, role=?, ext=?, mobile=?, is_active=1 WHERE id=?')
          .run(c.name, 'MANAGER', c.row.ext || null, c.row.mobile || null, existing.id);
      } else {
        db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role, dept_id, ext, mobile, created_by)
                    VALUES (?, NULL, ?, '', 'MANAGER', ?, ?, ?, 'link-directory')`)
          .run(c.to, c.name, c.row.dept_id, c.row.ext || null, c.row.mobile || null);
      }
    }
    for (const u of deletable) db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  })();

  for (const c of changes) {
    c.row.username   = c.to || '';
    c.row.arabic_name = c.name;
    c.row.confidence = c.to ? (c.manual ? '1.00' : c.toConf) : '0.00';
    c.row.ad_name    = c.to ? (adName.get(c.to) || c.row.ad_name) : '';
    const dept = cfg.departments.find(d => d.id === c.row.dept_id);
    if (dept && dept[c.row.rank]) {
      dept[c.row.rank].username = c.to || null;
      if (c.name) dept[c.row.rank].name = c.name;
    }
  }
  writeConfig(cfg);

  // Write EVERY link into directory.json, not only the ones that changed. Two
  // reasons: link-directory.js treats a username already in the roster as
  // decided by a human and will not re-guess it, so corrections survive the next
  // run; and server/data/ is gitignored — neither the database nor the review
  // CSV travels with the code — while config/ is committed, so this file is how
  // the link reaches the server. There, `link-directory.js --from-directory`
  // rebuilds everything from it without touching Active Directory.
  let saved = 0;
  try {
    const dir = dirDoc || JSON.parse(fs.readFileSync(DIR_PATH, 'utf8'));
    for (const r of rows) {
      const person = personFor(dir, r);
      if (!person) continue;
      person.name     = r.arabic_name;
      person.username = r.username || null;
      if (r.username) saved++;
    }
    fs.writeFileSync(DIR_PATH, JSON.stringify(dir, null, 2), 'utf8');
  } catch (e) {
    console.warn(`  warning — could not update directory.json: ${e.message}`);
  }

  const head = ['dept_id','dept_label','rank','role','arabic_name','ext','mobile',
                'username','ad_name','confidence','alternatives'];
  try {
    fs.writeFileSync(
      CSV_PATH,
      '﻿' + [head.join(',')].concat(rows.map(r => head.map(h => csvCell(r[h])).join(','))).join('\r\n'),
      'utf8'
    );
  } catch (e) {
    // The CSV is a record of what happened, not a source of truth — losing the
    // rewrite does not undo anything above.
    console.warn(`  warning — could not rewrite ${path.basename(CSV_PATH)}: ${e.code || e.message}`);
    console.warn('            the database and departments.json were still updated.');
  }

  console.log(`[fix] done
       ${changes.filter(c => c.to).length} posts pointed at the right account
       ${changes.filter(c => !c.to).length} posts deliberately left with no account
       ${deletable.length} stale accounts deleted
       ${saved} links saved into config/directory.json — commit it, that is what
         carries the link to the server (server/data/ is gitignored)

       Restart the server so the config cache reloads.
`);
}

main();
