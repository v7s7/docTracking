// server/scripts/backfill-emails.js
//
//   node scripts/backfill-emails.js            — show what would change, write nothing
//   node scripts/backfill-emails.js --apply    — write it
//
// Closes the gap behind "he didn't get the email": email only ever gets
// synced onto a local row when that PERSON signs into the web app themselves
// (routes/auth.js's LDAP branch updates it on every login). Someone active in
// the organisation who has simply never personally used the web app — a
// department head whose staff handle the system for him, a new starter who
// only just got an account — has a genuinely blank email column no matter how
// long they've been working, and every notify() in the system silently skips
// a blank address. This is not one person's problem; it is everyone in that
// position, org-wide.
//
// Uses the SAME read-only service account and the SAME resolveEmail()
// fallback chain (mail → proxyAddresses → userPrincipalName) already trusted
// for the "AD accounts with no role yet" panel — this just runs it against
// existing LOCAL rows instead of new ones, and only ever fills in a BLANK
// email. It never overwrites an email that is already on file.
require('dotenv').config();
const { db } = require('../db');
const { browseAllUsers } = require('../services/ldapService');

const APPLY = process.argv.includes('--apply');

(async () => {
  const blank = db.prepare(`
    SELECT id, username, full_name, dept_id FROM users
     WHERE is_active = 1 AND username IS NOT NULL AND username <> ''
       AND (email IS NULL OR email = '')
  `).all();

  if (!blank.length) {
    console.log('\n  No active account has a blank email. Nothing to do.\n');
    return;
  }

  console.log(`\n  ${blank.length} active account(s) with no email on file. Checking Active Directory...\n`);

  let adUsers;
  try {
    adUsers = await browseAllUsers();
  } catch (e) {
    console.error(`  Could not browse Active Directory: ${e.message}`);
    console.error('  Needs LDAP_BIND_DN / LDAP_BIND_PASSWORD in .env — same requirement as the');
    console.error('  "AD accounts with no role yet" panel on the Users page.\n');
    process.exit(1);
  }

  const byUsername = new Map(adUsers.map(u => [u.username.toLowerCase(), u]));
  const found = [];
  const stillMissing = [];

  for (const user of blank) {
    const ad = byUsername.get(user.username.toLowerCase());
    if (ad?.email) found.push({ ...user, email: ad.email });
    else stillMissing.push(user);
  }

  console.log(`  found an email in AD for   ${found.length}`);
  found.slice(0, 40).forEach(u => console.log(`    + ${u.username.padEnd(24)} ${u.email}`));
  if (found.length > 40) console.log(`      … and ${found.length - 40} more`);

  console.log(`\n  AD has no usable email for ${stillMissing.length}`);
  stillMissing.slice(0, 20).forEach(u => console.log(`    · ${u.username.padEnd(24)} ${u.full_name}`));
  if (stillMissing.length > 20) console.log(`      … and ${stillMissing.length - 20} more`);
  if (stillMissing.length) {
    console.log('  (disabled account, no mail/proxyAddresses/UPN AD will vouch for, or their');
    console.log('   sAMAccountName does not match the username stored locally — these still need');
    console.log('   a personal sign-in, or a manual email typed into their profile.)');
  }

  if (!found.length) { console.log(''); return; }

  if (!APPLY) {
    console.log('\n  Read the above. If it is right:');
    console.log('    node scripts/backfill-emails.js --apply\n');
    return;
  }

  const update = db.prepare('UPDATE users SET email = ? WHERE id = ? AND (email IS NULL OR email = \'\')');
  const applyAll = db.transaction(() => found.filter(u => update.run(u.email, u.id).changes === 1));
  const applied = applyAll();

  console.log(`\n  done: ${applied.length} email address(es) written.`);
  console.log('  They will be included the next time anything in their department is emailed —');
  console.log('  no restart needed, notify() reads the users table fresh every time.\n');
})();
