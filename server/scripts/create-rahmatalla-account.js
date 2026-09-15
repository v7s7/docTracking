#!/usr/bin/env node
/**
 * create-rahmatalla-account.js — give محمد طلحه وحيد his own account.
 *
 *   node scripts/create-rahmatalla-account.js            # report only
 *   node scripts/create-rahmatalla-account.js --apply    # write it
 *
 * The last of the three people tangled up in the abdullatif/faour mixup
 * (see fix-abdullatif-faour-accounts.js and its round2). His data was never
 * wrong so much as homeless: his mobile number was stray data sitting on
 * m.abdullatif's row until round2 cleared it, and round 1 correctly left
 * him unmatched rather than guess at his AD account. Real AD identity
 * confirmed directly this conversation: username m.rahmatalla, email
 * m.rahmatalla@swd.bh.
 *
 * dept_id/ext/mobile come from config/directory.json's own
 * engineering_services_dept entry for him — the same roster data this whole
 * family of scripts has been treating as ground truth throughout.
 *
 * created_by is set to 'link-directory', same marker every other roster-
 * seeded, no-password account carries — that's what makes an account
 * eligible for fix-directory-links.js's own orphan cleanup if it's ever
 * wrong and unclaimed, and this one should behave the same way if it turns
 * out to need correcting later.
 *
 * Self-verifying like the rest of this family: refuses if a row with this
 * username already exists rather than silently overwrite it (he may have
 * logged in himself since this was written).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { db } = require('../db');

const APPLY = process.argv.includes('--apply');

const PERSON = {
  username: 'm.rahmatalla',
  email: 'm.rahmatalla@swd.bh',
  full_name: 'محمد طلحه وحيد',
  dept_id: 'engineering_services_dept',
  ext: '4006',
  mobile: '33104704',
  role: 'STAFF',
};

function main() {
  console.log('\n[create] checking current state...\n');

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(PERSON.username);
  if (existing) {
    console.error(`  refusing — a row for "${PERSON.username}" already exists (id ${existing.id}, full_name "${existing.full_name}").`);
    console.error('  He may have logged in himself since this was written. Not overwriting. Nothing changed.');
    process.exit(1);
  }
  console.log(`  OK — no existing row for "${PERSON.username}".`);

  console.log('  will create:');
  console.log(`    username   ${PERSON.username}`);
  console.log(`    email      ${PERSON.email}`);
  console.log(`    full_name  ${PERSON.full_name}`);
  console.log(`    dept_id    ${PERSON.dept_id}`);
  console.log(`    ext        ${PERSON.ext}`);
  console.log(`    mobile     ${PERSON.mobile}`);
  console.log(`    role       ${PERSON.role}`);
  console.log('    password   (none — AD-authenticated, same as everyone else here)\n');

  if (!APPLY) {
    console.log('[create] dry run — nothing written. Re-run with --apply to make this change.\n');
    return;
  }

  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, email, role, dept_id, ext, mobile, created_by)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'link-directory')
  `).run(PERSON.username, PERSON.full_name, PERSON.email, PERSON.role, PERSON.dept_id, PERSON.ext, PERSON.mobile);

  const created = db.prepare('SELECT id, username, full_name, dept_id, ext, mobile, email FROM users WHERE username = ?').get(PERSON.username);
  console.log('[create] done:');
  console.log('  ', JSON.stringify(created));
  console.log('\n  He can log in immediately with his AD credentials — full_name will sync to');
  console.log('  whatever AD calls him the moment he first does.\n');
}

main();
