#!/usr/bin/env node
/**
 * fix-abdullatif-faour-round2.js — production had already drifted from what
 * round 1 (fix-abdullatif-faour-accounts.js) expected, and it correctly
 * refused rather than guess. This is what actually needs to happen instead.
 *
 *   node scripts/fix-abdullatif-faour-round2.js            # report only
 *   node scripts/fix-abdullatif-faour-round2.js --apply    # write it
 *
 * WHAT check-abdullatif-faour-state.js showed on production:
 *
 *   m.abdullatif — full_name "Mohamed Abdullatif" (AD-synced), dept and ext
 *   already correct (mosques_guidance_dept, 5069), mobile WRONG (holds
 *   محمد طلحه وحيد's number). Has a LIVE session and login history since
 *   2026-08-30 — a real person is actively using this exact account.
 *
 *   m.faour — a complete, exact duplicate of محمد عبداللطيف محمد's profile
 *   (name, dept, ext, AND the correct mobile) sitting under the wrong
 *   username. Zero sessions, zero audit_log — never used. Left over from the
 *   same flawed import round 1 targeted.
 *
 * auth.js's LDAP branch (read directly before writing this) only ever
 * UPDATEs full_name/email on an EXISTING row matched by the true AD
 * username — it never auto-creates one, and never touches dept_id, ext, or
 * mobile. So whatever round 1 wrote to production on 2026-08-13 is exactly
 * what is still sitting in dept_id/ext/mobile today, untouched by every
 * login since.
 *
 * THE FIX
 *   m.abdullatif (real, live account) → correct only the one wrong field:
 *     mobile 33104704 → 35676906. Username, id, dept_id, ext, full_name,
 *     email, session: all untouched.
 *   m.faour (dormant duplicate, zero references) → deleted outright, same
 *     as the "orphan" cleanup fix-directory-links.js already does for an
 *     unclaimed link-directory row. Frees the username for whoever actually
 *     is Mohamad Nadeem Faour to use the moment he first logs in.
 *
 * محمد طلحه وحيد is not touched by this at all — he has no row on
 * production to begin with (his mobile number was only ever stray data on
 * m.abdullatif, never a real account of his). Nothing to undo for him here.
 *
 * Self-verifying like the rest of this family: refuses instead of guessing
 * if reality has moved again since this was written, and refuses the delete
 * outright if anything anywhere references that row.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { db } = require('../db');

const APPLY = process.argv.includes('--apply');

const ID_COLS   = ['user_id','from_user_id','to_user_id','sender_id','approver_id','assigned_to','assigned_by','owner_id','uploaded_by','actor_id','created_by_id','recipient_id','member_id'];
const NAME_COLS = ['username','from_username','approver','actor'];

function referencesTo(id, username) {
  const hits = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  for (const t of tables) {
    if (t === 'users') continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    for (const c of cols) {
      const byId = ID_COLS.includes(c), byName = NAME_COLS.includes(c);
      if (!byId && !byName) continue;
      try {
        const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = ?`).get(byId ? id : username).n;
        if (n) hits.push(`${t}.${c} (${n})`);
      } catch { /* column type mismatch — not a reference */ }
    }
  }
  return hits;
}

function main() {
  console.log('\n[fix round 2] checking current state against what this script expects...\n');

  const abdullatif = db.prepare("SELECT * FROM users WHERE username = 'm.abdullatif'").get();
  const faour       = db.prepare("SELECT * FROM users WHERE username = 'm.faour'").get();

  if (!abdullatif || !faour) {
    console.error('  refusing — expected both m.abdullatif and m.faour to exist. Nothing changed.');
    process.exit(1);
  }

  if (abdullatif.dept_id !== 'mosques_guidance_dept') {
    console.error(`  refusing — m.abdullatif.dept_id is "${abdullatif.dept_id}", expected mosques_guidance_dept. Reality has moved again — stopping rather than guess.`);
    process.exit(1);
  }
  if (abdullatif.mobile === '35676906') {
    console.log('  m.abdullatif.mobile is already correct (35676906) — nothing to fix there.');
  } else {
    console.log(`  OK — m.abdullatif.mobile is "${abdullatif.mobile}", will become 35676906.`);
  }

  const faourSessions = db.prepare('SELECT COUNT(*) n FROM sessions WHERE username = ?').get('m.faour').n;
  const abdullatifSessions = db.prepare('SELECT COUNT(*) n FROM sessions WHERE username = ?').get('m.abdullatif').n;
  console.log(`  m.abdullatif has ${abdullatifSessions} session(s) — this account is left untouched except its mobile field.`);
  console.log(`  m.faour has ${faourSessions} session(s) — must be 0 for the delete below to be safe.\n`);

  if (faour.password_hash) {
    console.error('  refusing — m.faour has a local password set, meaning a real person has been using this exact login. Not deleting.');
    process.exit(1);
  }
  if (faour.full_name !== 'محمد عبداللطيف محمد') {
    console.log(`  m.faour.full_name is "${faour.full_name}", not محمد عبداللطيف محمد — this no longer looks like the`);
    console.log('  duplicate this script was written for (maybe it was already fixed some other way).');
    console.log('  Not touching it. Only the mobile-number fix above (if any) applies.\n');
    if (APPLY && abdullatif.mobile !== '35676906') {
      db.prepare("UPDATE users SET mobile = '35676906' WHERE username = 'm.abdullatif'").run();
      console.log('[fix round 2] m.abdullatif.mobile corrected. m.faour left as-is.\n');
    } else if (!APPLY) {
      console.log('[fix round 2] dry run — nothing written.\n');
    } else {
      console.log('[fix round 2] nothing to do.\n');
    }
    return;
  }

  const refs = referencesTo(faour.id, 'm.faour');
  if (faourSessions || refs.length) {
    console.error('  refusing to delete m.faour — found real activity or references:');
    if (faourSessions) console.error(`    sessions (${faourSessions})`);
    refs.forEach(r => console.error(`    ${r}`));
    process.exit(1);
  }
  console.log('  OK — m.faour (id ' + faour.id + ') has no sessions and nothing anywhere references it. Safe to delete.\n');

  console.log('  m.faour row about to be deleted, in full, for the record:');
  console.log('   ', JSON.stringify(faour));
  console.log('');

  if (!APPLY) {
    console.log('[fix round 2] dry run — nothing written. Re-run with --apply to make these changes.\n');
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET mobile = '35676906' WHERE username = 'm.abdullatif'").run();
    db.prepare("DELETE FROM users WHERE username = 'm.faour'").run();
  })();

  const after = db.prepare("SELECT id, username, full_name, dept_id, ext, mobile, email FROM users WHERE username = 'm.abdullatif'").get();
  console.log('[fix round 2] done. m.abdullatif now:');
  console.log('  ', JSON.stringify(after));
  console.log('\n  m.faour deleted. It will be recreated correctly the moment its real');
  console.log('  owner (Mohamad Nadeem Faour) is given an account or first logs in.\n');
}

main();
