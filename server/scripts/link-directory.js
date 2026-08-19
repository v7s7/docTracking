#!/usr/bin/env node
/**
 * link-directory.js — connect the phone directory to real Active Directory
 * accounts, then assign every person their department and role.
 *
 *   node scripts/link-directory.js            # 1. review pass  → writes a CSV
 *   node scripts/link-directory.js --apply    # 2. apply pass   → writes the DB
 *
 *   node scripts/link-directory.js --from-directory
 *       Deploy pass. Rebuilds the users table and the head/deputy links from
 *       config/directory.json alone — no Active Directory, no CSV, no review.
 *       This is what you run on the server after `git pull`.
 *
 *   node scripts/link-directory.js --check
 *       Read-only health report: who can approve for each department, and
 *       whether any named head/deputy is missing their user row.
 *
 * WHY TWO PASSES
 * The directory holds Arabic names (حبيب غلام النامليتي); Active Directory
 * holds Latin ones (Habib Ghulam Alnamliti). Nothing can match those two with
 * certainty, so pass 1 transliterates and guesses, writes every guess to a CSV
 * with a confidence score, and stops. You correct the CSV. Pass 2 trusts it.
 *
 * WHAT PASS 2 WRITES
 *   • users            — one row per linked person: username, full_name, role, dept_id
 *   • departments.json — head.username / deputy.username, which is what the
 *                        correspondence approval check actually reads
 * Both are upserts: re-running changes nothing that is already correct, and a
 * blank username row is skipped rather than clearing anything.
 */
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db }             = require('../db');
const { readConfig, writeConfig } = require('../services/configService');
// Required lazily inside review(): the review pass is the only one that talks to
// Active Directory, and a deploy (--from-directory) must not be blocked by an
// LDAP problem it never uses.

const APPLY    = process.argv.includes('--apply');
const FROM_DIR = process.argv.includes('--from-directory');
const CHECK    = process.argv.includes('--check');
const CSV_PATH = path.join(__dirname, '..', 'data', 'directory-link.csv');

// ── Arabic → Latin, phonetic and deliberately loose ────────────────────────
const MAP = {
  'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h',
  'خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d',
  'ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m',
  'ن':'n','ه':'h','ة':'a','و':'w','ي':'y','ى':'a','ء':'','ئ':'y','ؤ':'w',
};
const NOISE = new Set(['al','bin','bint','abu','abd','abdul','el','the','a','of']);

// AD accounts that are out of service. Nobody is ever matched to these, however
// well the name scores. omran.t is here because the surname alone pulled
// عمار حسن طيب onto it at 0.83 — the account belongs to عمران, not عمار.
const RETIRED = new Set(['omran.t']);

function translit(ar) {
  return String(ar)
    .replace(/عبد\s*ال/g, 'abdul')          // عبدالله → abdulla, not "abd al lh"
    .replace(/ـ/g, '')                  // tatweel
    .replace(/[ً-ْ]/g, '')         // harakat
    .split('')
    .map(ch => (ch in MAP ? MAP[ch] : (/\s/.test(ch) ? ' ' : ch)))
    .join('')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = s => translit(s).split(' ').filter(w => w.length > 1 && !NOISE.has(w));

// Similarity of two words, 0..1 — cheap Levenshtein ratio.
function wordScore(a, b) {
  if (a === b) return 1;
  // A shared prefix only means something when it is a real chunk of both words.
  // Without this, the service account "EWA" scored 0.85 against وليد, because
  // "w" is technically a prefix of "wlyd".
  if (a.startsWith(b) || b.startsWith(a)) {
    const short = Math.min(a.length, b.length);
    const long  = Math.max(a.length, b.length);
    if (short >= 3 && short / long >= 0.5) return 0.85;
  }
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

// Arabic script omits short vowels, so a transliteration reads "hsham mhmd"
// where AD holds "Hesham Mohamed". Comparing consonant skeletons — vowels
// stripped from both sides — is what makes those two recognisably the same
// name. Scores are taken as the better of the literal and skeleton passes.
// 'y' counts as a vowel here: Arabic ي transliterates to y but Latin spells it
// i or ee (خيري → khyry, AD holds "Khairi"). Dropping it makes both khr.
const skeleton = w => w.replace(/[aeiouy]/g, '') || w;

/**
 * Best pairing between the Arabic name's words and the AD display name's.
 *
 * Averaging over EVERY Arabic token punishes names that simply have more
 * parts on one side — "ملك عادل خان" vs "Malik Adil" scored 0.67 purely
 * because "khan" had nothing to pair with, and "عبدالله فؤاد خيري" vs
 * "Abdulla F. Khairi" scored 0.54 because the initial "F." is dropped as
 * noise. So score only the best min(|A|,|B|) pairings.
 *
 * That alone would let a single shared common name (محمد / Mohamed) carry a
 * stranger over the line, so a match also has to have two genuinely strong
 * token pairs — or be a one-word name matched outright.
 */
function nameScore(arabic, latin) {
  const A = tokens(arabic);
  const B = String(latin).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !NOISE.has(w));
  if (!A.length || !B.length) return 0;

  const best = A.map(a => Math.max(...B.map(b => Math.max(
    wordScore(a, b),
    wordScore(skeleton(a), skeleton(b)),
  )))).sort((x, y) => y - x);

  const k     = Math.min(A.length, B.length);
  const score = best.slice(0, k).reduce((s, x) => s + x, 0) / k;

  // Everyone in the directory has at least two name parts. A one-token AD
  // entry is a service account (EWA, IT Support) — never auto-link those.
  if (k < 2) return Math.min(score, 0.6);

  // Two strong pairs is the right bar for a three-part name, but too strict for
  // a two-part one, where it would demand a perfect match on both halves.
  const strong = best.filter(x => x >= 0.8).length;
  const enough = k >= 3 ? strong >= 2 : strong >= 1;
  return enough ? score : Math.min(score, 0.6);   // held below the threshold
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ── Pass 1 — propose ──────────────────────────────────────────────────────
async function review() {
  const { browseAllUsers } = require('../services/ldapService');
  console.log('[link] contacting Active Directory…');
  const ad = await browseAllUsers();
  console.log(`[link] ${ad.length} enabled AD accounts found`);

  const cfg   = readConfig();
  const dirPath = path.join(__dirname, '..', 'config', 'directory.json');
  const roster  = JSON.parse(fs.readFileSync(dirPath, 'utf8')).departments;
  const label   = Object.fromEntries(cfg.departments.map(d => [d.id, d.label]));

  // username -> the person who claimed it. A Map, not a Set, because the same
  // person legitimately appears twice: علي محمد قمبر heads both الموارد البشرية
  // and الخدمات الإدارية. Blocking the second occurrence would hand that post
  // the runner-up match — a different employee's account.
  const taken = new Map();
  const rows  = [];

  for (const [deptId, people] of Object.entries(roster)) {
    people.forEach((p, i) => {
      const rank = i === 0 ? 'head' : i === 1 ? 'deputy' : 'staff';
      const role = i <= 1 ? 'MANAGER' : 'STAFF';
      const base = {
        dept_id: deptId,
        dept_label: label[deptId] || deptId,
        rank, role,
        arabic_name: p.name,
        ext: p.ext || '', mobile: p.mobile || '',
      };

      // A username already written into directory.json was decided by a human.
      // Never re-guess it — that is how a correction survives the next run.
      if (p.username) {
        taken.set(p.username, p.name);
        const acct = ad.find(u => String(u.username).toLowerCase() === String(p.username).toLowerCase());
        rows.push({ ...base,
          username: p.username,
          ad_name: acct ? (acct.name || '') : '',
          // The email has to be carried here too, not only on the fuzzy-match
          // path below. Once a username has been written back into
          // directory.json this branch is the one almost everybody takes, so
          // omitting it left 120 of 121 rows with a blank address.
          email: acct ? (acct.email || '') : '',
          confidence: '1.00',
          alternatives: 'confirmed by hand',
        });
        return;
      }

      const scored = ad
        .filter(u => !RETIRED.has(String(u.username).toLowerCase()))
        .map(u => ({ u, s: nameScore(p.name, u.name || u.username) }))
        .sort((a, b) => b.s - a.s);

      // Skip accounts already claimed by a *different* person — but let the same
      // person keep their own account across every post they hold.
      const best = scored.find(x =>
        !taken.has(x.u.username) || taken.get(x.u.username) === p.name
      ) || { u: {}, s: 0 };
      const confident = best.s >= 0.72;
      if (confident) taken.set(best.u.username, p.name);

      rows.push({ ...base,
        username: confident ? best.u.username : '',
        ad_name: confident ? (best.u.name || '') : '',
        // AD already returns mail (see browseAllUsers). Carrying it through is
        // the whole reason 112 of 119 accounts had no address: it was fetched
        // here and dropped before --apply ever saw it.
        email: confident ? (best.u.email || '') : '',
        confidence: best.s ? best.s.toFixed(2) : '0.00',
        // Runners-up, so a wrong guess is easy to correct by hand.
        alternatives: scored.slice(0, 3).filter(x => x.s > 0.4)
          .map(x => `${x.u.username}=${x.s.toFixed(2)}`).join(' | '),
      });
    });
  }

  const head = ['dept_id','dept_label','rank','role','arabic_name','ext','mobile',
                'username','email','ad_name','confidence','alternatives'];
  const csv = [head.join(',')]
    .concat(rows.map(r => head.map(h => csvCell(r[h])).join(',')))
    .join('\r\n');
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(CSV_PATH, '﻿' + csv, 'utf8');   // BOM so Excel reads Arabic

  const matched = rows.filter(r => r.username).length;
  const leaders = rows.filter(r => r.rank !== 'staff');
  console.log(`
[link] ${rows.length} people in the directory
[link] ${matched} auto-matched to an AD account (confidence >= 0.72)
[link] ${rows.length - matched} need a username filled in by hand
[link] heads/deputies matched: ${leaders.filter(r => r.username).length} / ${leaders.length}
[link] with an email address:  ${rows.filter(r => r.email).length} / ${matched}${
  rows.filter(r => r.email).length === 0
    ? '   ** none — AD returned no usable address; check mail / proxyAddresses / userPrincipalName **'
    : ''}

  Review:  ${CSV_PATH}
  Fill the "username" column where it is blank, correct anything wrong
  (the "alternatives" column lists runners-up), then run:

      node scripts/link-directory.js --apply
`);
}

// ── Pass 2 — apply ────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head  = lines.shift().split(',');
  return lines.map(line => {
    const cells = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
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

function apply() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[link] ${CSV_PATH} not found — run without --apply first.`);
    process.exit(1);
  }
  const all   = parseCsv(fs.readFileSync(CSV_PATH, 'utf8')).filter(r => r.username);
  const cfg   = readConfig();
  const valid = new Set(cfg.departments.map(d => d.id));
  const ROLES = new Set(['SUPER_ADMIN','ADMIN','CUSTOMER_SERVICE','MANAGER','STAFF','READONLY']);

  let created = 0, updated = 0, skipped = 0, leaders = 0;

  const rows = all.filter(r => {
    if (valid.has(r.dept_id)) return true;
    console.warn(`  skip — unknown department "${r.dept_id}" (${r.arabic_name})`);
    skipped++;
    return false;
  });

  // users.dept_id is scalar but a person can hold a post in two departments, so
  // collapse to one row per account and keep the strongest post. Without this a
  // later staff row would overwrite a head row and demote a department head to
  // STAFF. Approval authority is untouched either way — it is read from
  // departments.json below, which keeps every post.
  const RANK = { head: 0, deputy: 1, staff: 2 };
  const primary = new Map();
  for (const r of rows) {
    const cur = primary.get(r.username);
    if (!cur || (RANK[r.rank] ?? 2) < (RANK[cur.rank] ?? 2)) primary.set(r.username, r);
  }

  const run = db.transaction(() => {
    for (const r of primary.values()) {
      const role = ROLES.has(r.role) ? r.role : 'STAFF';
      const name = r.arabic_name || r.ad_name || r.username;

      const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(r.username);
      if (existing) {
        if (existing.password_hash) {   // never touch a local password account
          console.warn(`  skip — "${r.username}" is a local account, not AD`); skipped++; continue;
        }
        // COALESCE(NULLIF(...)) so a blank in the sheet never wipes an address
        // the person already has — a login writes one too, and that must win
        // over an empty cell.
        db.prepare(`UPDATE users SET full_name=?, role=?, dept_id=?, ext=?, mobile=?,
                      email = COALESCE(NULLIF(?, ''), email), is_active=1 WHERE id=?`)
          .run(name, role, r.dept_id, r.ext || null, r.mobile || null, r.email || '', existing.id);
        updated++;
      } else {
        db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role, dept_id, ext, mobile, created_by)
                    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'link-directory')`)
          .run(r.username, name, r.email || '', role, r.dept_id, r.ext || null, r.mobile || null);
        created++;
      }

    }
  });

  run();

  // The approval check reads head/deputy usernames from departments.json, so the
  // link has to be written there too — not only into users. This walks every row,
  // not the collapsed set, so a person heading two departments is head of both.
  for (const r of rows) {
    if (r.rank !== 'head' && r.rank !== 'deputy') continue;
    const dept = cfg.departments.find(d => d.id === r.dept_id);
    if (dept && dept[r.rank]) { dept[r.rank].username = r.username; leaders++; }
  }

  writeConfig(cfg);

  console.log(`
[link] done
       ${created} accounts created
       ${updated} accounts updated
       ${skipped} skipped
       ${leaders} head/deputy links written into departments.json

       Restart the server so the config cache reloads.
`);
}

// ── Apply from directory.json — no Active Directory, no CSV ───────────────
// server/data/ is gitignored, so neither the database nor the review CSV travels
// with the code. config/ is committed, which makes directory.json the portable
// record of the link: every person's username is written into it by
// fix-directory-links.js. On the server, pull and run this — it rebuilds the
// user rows and the head/deputy links deterministically, with no matching and
// nothing to review a second time.
function applyFromDirectory() {
  const dirPath = path.join(__dirname, '..', 'config', 'directory.json');
  const roster  = JSON.parse(fs.readFileSync(dirPath, 'utf8')).departments;
  const cfg     = readConfig();
  const valid   = new Set(cfg.departments.map(d => d.id));

  const posts = [];
  for (const [deptId, people] of Object.entries(roster)) {
    if (!valid.has(deptId)) { console.warn(`  skip — unknown department "${deptId}"`); continue; }
    people.forEach((p, i) => {
      if (!p.username) return;
      posts.push({
        deptId, username: p.username, name: p.name,
        ext: p.ext || null, mobile: p.mobile || null,
        // Optional second work address (a personal Gmail, typically). Filling it
        // in directory.json means the whole set can be pasted in one edit and
        // carried to the server by git, rather than typed 140 times in the UI.
        altEmail: p.alt_email || p.altEmail || null,
        rank: i === 0 ? 'head' : i === 1 ? 'deputy' : 'staff',
        role: i <= 1 ? 'MANAGER' : 'STAFF',
      });
    });
  }
  const unlinked = Object.values(roster).flat().filter(p => !p.username).length;

  // Same collapse rule as apply(): one row per account, strongest post wins.
  const RANK = { head: 0, deputy: 1, staff: 2 };
  const primary = new Map();
  for (const p of posts) {
    const cur = primary.get(p.username);
    if (!cur || RANK[p.rank] < RANK[cur.rank]) primary.set(p.username, p);
  }

  let created = 0, updated = 0, skipped = 0, leaders = 0;
  db.transaction(() => {
    for (const p of primary.values()) {
      const existing = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(p.username);
      if (existing) {
        if (existing.password_hash) { console.warn(`  skip — "${p.username}" is a local account, not AD`); skipped++; continue; }
        // alt_email is only written when the roster actually carries one, so a
        // roster without the column never blanks an address entered by hand.
        if (p.altEmail) {
          db.prepare('UPDATE users SET full_name=?, role=?, dept_id=?, ext=?, mobile=?, alt_email=?, is_active=1 WHERE id=?')
            .run(p.name, p.role, p.deptId, p.ext, p.mobile, p.altEmail, existing.id);
        } else {
          db.prepare('UPDATE users SET full_name=?, role=?, dept_id=?, ext=?, mobile=?, is_active=1 WHERE id=?')
            .run(p.name, p.role, p.deptId, p.ext, p.mobile, existing.id);
        }
        updated++;
      } else {
        db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role, dept_id, ext, mobile, alt_email, created_by)
                    VALUES (?, NULL, ?, '', ?, ?, ?, ?, ?, 'link-directory')`)
          .run(p.username, p.name, p.role, p.deptId, p.ext, p.mobile, p.altEmail);
        created++;
      }
    }
  })();

  for (const p of posts) {
    if (p.rank === 'staff') continue;
    const dept = cfg.departments.find(d => d.id === p.deptId);
    if (dept && dept[p.rank]) { dept[p.rank].username = p.username; dept[p.rank].name = p.name; leaders++; }
  }
  writeConfig(cfg);

  console.log(`
[link] done — applied from config/directory.json, no AD lookup
       ${created} accounts created
       ${updated} accounts updated
       ${skipped} skipped
       ${leaders} head/deputy links written into departments.json
       ${unlinked} people in the roster still have no account

       Restart the server so the config cache reloads.
`);
}

// ── Check — read-only health report ───────────────────────────────────────
// Run this after a deploy. It answers the only question that matters: can every
// department actually get its correspondence approved?
function check() {
  const { canApproveFor, approversOf } = require('../utils/approvals');
  const cfg   = readConfig();
  const users = db.prepare('SELECT id, username, full_name, role, dept_id, ext FROM users WHERE is_active = 1').all();
  const roster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'directory.json'), 'utf8')).departments;
  const people = Object.values(roster).flat();

  console.log(`
[check] ${users.length} active users, ${users.filter(u => u.ext).length} with an extension
[check] ${people.filter(p => p.username).length}/${people.length} people in the roster are linked to an account
`);

  const none = [], one = [];
  const w = Math.max(...cfg.departments.map(d => d.label.length)) + 2;
  for (const d of cfg.departments) {
    const who = users.filter(u => canApproveFor(u, d.id)).map(u => u.username);
    if (!who.length) none.push(d.label); else if (who.length === 1) one.push(d.label);
    console.log(`  ${String(who.length).padStart(2)}  ${d.label.padEnd(w)}${who.join(', ') || '** NO APPROVER **'}`);
  }

  // A head/deputy named in departments.json but with no matching user row can
  // never approve — the commonest way a deploy looks fine and is not.
  const ghosts = [];
  for (const d of cfg.departments) {
    for (const u of approversOf(d.id)) {
      if (!users.some(x => String(x.username).toLowerCase() === String(u).toLowerCase())) ghosts.push(`${d.label}: ${u}`);
    }
  }

  console.log(`
[check] ${cfg.departments.length - none.length - one.length} departments with two approvers, ${one.length} with one, ${none.length} with none`);
  if (none.length)   console.log(`        no approver: ${none.join(', ')}`);
  if (ghosts.length) {
    console.log(`\n        ${ghosts.length} head/deputy named in departments.json with NO user row —`);
    console.log('        they cannot approve until the account exists:');
    for (const g of ghosts) console.log(`          ${g}`);
    console.log('        Run: node scripts/link-directory.js --from-directory');
  } else {
    console.log('        every named head/deputy has a user row\n');
  }
}

(async () => {
  try {
    if (CHECK) check();
    else if (FROM_DIR) applyFromDirectory();
    else if (APPLY) apply();
    else await review();
    process.exit(0);
  } catch (e) {
    console.error('[link] FAILED:', e.message);
    if (e.code === 'NOT_CONFIGURED') console.error('       Set LDAP_BIND_DN and LDAP_BIND_PASSWORD in server/.env');
    process.exit(1);
  }
})();
