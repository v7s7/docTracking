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
 *   m.faour (dormant, never logged in) → repurposed in place into Mohamad
 *     Nadeem Faour's own correct row (name, maintenance_dept, no ext,
 *     mobile 66333554, email m.faour@swd.bh — confirmed directly this
 *     conversation), instead of deleting it and leaving him with no account
 *     until someone notices and creates one. It does have a handful of
 *     correspondence_notifications / chat_email_log rows — stale department-
 *     broadcast artifacts from sitting in the wrong department, not personal
 *     approval requests (checked: neither account is that department's
 *     configured head/deputy) — cleared as part of the repurpose since they
 *     play no part in computing who may actually approve anything.
 *
 * محمد طلحه وحيد is not touched by this at all — he has no row on
 * production to begin with (his mobile number was only ever stray data on
 * m.abdullatif, never a real account of his). Nothing to undo for him here.
 *
 * Self-verifying like the rest of this family: refuses instead of guessing
 * if reality has moved again since this was written, and refuses to touch
 * m.faour at all if anything anywhere references that row.
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
    console.error('  refusing — m.faour has a local password set, meaning a real person has been using this exact login. Not touching it.');
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

  // correspondence_notifications and chat_email_log are pure notification
  // bookkeeping (read directly in services/correspondenceNotify.js and
  // db/index.js before writing this) — never consulted to decide who may
  // approve what, so clearing them cannot change any real workflow state.
  // Anything else referencing this row is unknown territory: refuse rather
  // than guess.
  const refs = referencesTo(faour.id, 'm.faour');
  const KNOWN_SAFE = ['correspondence_notifications', 'chat_email_log'];
  const unknownRefs = refs.filter(r => !KNOWN_SAFE.some(t => r.startsWith(t + '.')));

  if (faourSessions || unknownRefs.length) {
    console.error('  refusing to repurpose m.faour — found activity or references this script does not know how to handle safely:');
    if (faourSessions) console.error(`    sessions (${faourSessions})`);
    unknownRefs.forEach(r => console.error(`    ${r}`));
    process.exit(1);
  }

  if (refs.length) {
    console.log('  m.faour has notification bookkeeping rows, but nothing that represents real use of the login:\n');
    const notifRows = db.prepare(`
      SELECT n.id, n.correspondence_id, n.serial, n.subject, n.type, n.is_read, n.created_at, c.status
        FROM correspondence_notifications n LEFT JOIN correspondences c ON c.id = n.correspondence_id
       WHERE n.user_id = ?`).all(faour.id);
    notifRows.forEach(r => console.log(`    correspondence_notifications#${r.id}  ${r.serial || '(no serial)'}  "${r.subject || ''}"  type=${r.type}  read=${!!r.is_read}  correspondence status=${r.status || '?'}  ${r.created_at}`));
    const chatRows = db.prepare('SELECT conversation_id, last_emailed_at FROM chat_email_log WHERE user_id = ?').all(faour.id);
    chatRows.forEach(r => console.log(`    chat_email_log  conversation_id=${r.conversation_id}  last_emailed_at=${r.last_emailed_at}`));
    console.log('\n  These exist because this id was incorrectly sitting in mosques_guidance_dept: automated');
    console.log('  department-wide notifications addressed "whoever is active here" and wrongly picked up this');
    console.log('  never-logged-in account along with it (neither m.faour nor m.abdullatif is that department\'s');
    console.log('  configured head/deputy, so none of these are personal approval requests). Correspondence');
    console.log('  approval is computed fresh from department config every time, never from these rows — clearing');
    console.log('  them changes no one\'s ability to approve or act on anything still open. Left in place, they');
    console.log('  would only show up as confusing unread badges about a department Nadeem Faour has nothing to');
    console.log('  do with, so they are cleared as part of the repurpose below.\n');
  }

  console.log('  OK — m.faour (id ' + faour.id + ') has no sessions and no references this script cannot account for. Safe to repurpose.\n');

  console.log('  m.faour row before the change, for the record:');
  console.log('   ', JSON.stringify(faour));
  console.log('');
  console.log('  becomes:');
  console.log('    full_name محمد نديم فاعور, dept_id maintenance_dept, ext (none), mobile 66333554, email m.faour@swd.bh\n');

  if (!APPLY) {
    console.log('[fix round 2] dry run — nothing written. Re-run with --apply to make these changes.\n');
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET mobile = '35676906' WHERE username = 'm.abdullatif'").run();
    db.prepare('DELETE FROM correspondence_notifications WHERE user_id = ?').run(faour.id);
    db.prepare('DELETE FROM chat_email_log WHERE user_id = ?').run(faour.id);
    db.prepare("UPDATE users SET full_name=?, dept_id=?, ext=?, mobile=?, email=? WHERE username = 'm.faour'")
      .run('محمد نديم فاعور', 'maintenance_dept', null, '66333554', 'm.faour@swd.bh');
  })();

  const abdullatifAfter = db.prepare("SELECT id, username, full_name, dept_id, ext, mobile, email FROM users WHERE username = 'm.abdullatif'").get();
  const faourAfter      = db.prepare("SELECT id, username, full_name, dept_id, ext, mobile, email FROM users WHERE username = 'm.faour'").get();
  console.log('[fix round 2] done.');
  console.log('  m.abdullatif now:', JSON.stringify(abdullatifAfter));
  console.log('  m.faour now:     ', JSON.stringify(faourAfter));
  console.log('');
}

main();
