// server/scripts/unlink-department-role.js
//
//   node scripts/unlink-department-role.js <username> <dept_id>            — dry run
//   node scripts/unlink-department-role.js <username> <dept_id> --apply    — write it
//
// Removes ONE person from ONE department's head/deputy slot in
// config/departments.json, without touching anything else in the file.
//
// Why a script and not a hand edit or a git push: this file is written to
// directly by the running server whenever someone uses the Super Admin
// panel's department screens — it is live, mutable, server-owned data, not
// something a git pull should ever overwrite. This reads whatever the file
// ACTUALLY contains right now, on this machine, and changes only the one
// thing asked for. It refuses outright if reality does not match what was
// expected, rather than guessing.
//
// Uses configService's own readConfig()/writeConfig() — the same functions
// the admin panel's own routes call — so the write behaves identically to
// clicking through the UI.
//
// The running server's in-memory copy of this file is NOT updated by this
// script — that cache is per-process and only refreshes on that process's own
// write, or a restart. The file on disk is correct the moment this runs; the
// live server needs a restart to actually read it.
require('dotenv').config();
const { readConfig, writeConfig } = require('../services/configService');

const [username, deptId] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');

if (!username || !deptId) {
  console.error('\n  Usage: node scripts/unlink-department-role.js <username> <dept_id> [--apply]\n');
  process.exit(1);
}

const sameUser = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const cfg  = readConfig();
const dept = cfg.departments.find(d => d.id === deptId);

if (!dept) {
  console.error(`\n  No department with id "${deptId}" in the current config. Known ids:`);
  cfg.departments.forEach(d => console.error(`    ${d.id}`));
  console.error('');
  process.exit(1);
}

const slots = ['head', 'deputy'].filter(slot => sameUser(dept[slot]?.username, username));

console.log(`\n  ${dept.label} (${dept.id}) — current head/deputy:`);
console.log(`    head:   ${dept.head?.name || '(none)'}  ${dept.head?.username ? `(${dept.head.username})` : ''}`);
console.log(`    deputy: ${dept.deputy?.name || '(none)'}  ${dept.deputy?.username ? `(${dept.deputy.username})` : ''}`);

if (!slots.length) {
  console.log(`\n  "${username}" is not currently listed as head or deputy of ${dept.id}.`);
  console.log('  Nothing to do — the live config no longer matches what was expected, so this');
  console.log('  refuses to guess. Someone may have already changed it via the admin panel.\n');
  process.exit(0);
}

console.log(`\n  found: listed as ${slots.join(' AND ')} of ${dept.label}.`);

if (!APPLY) {
  console.log('\n  Read the above. If it is right:');
  console.log(`    node scripts/unlink-department-role.js ${username} ${deptId} --apply\n`);
  process.exit(0);
}

// Clear only the login link (username), the same way an unlinked deputy
// already looks elsewhere in this file (e.g. board_office's deputy has a
// name, an ext, a mobile — and username: null). The name/contact fields are
// organisational facts independent of who is logged in as whom; only the
// "this account approves on this department's behalf" link is being removed.
for (const slot of slots) dept[slot].username = null;

writeConfig(cfg);

console.log(`\n  done: ${username} no longer approves for ${dept.label} as ${slots.join(' or ')}.`);
console.log('  Their name/contact info in that slot is untouched — only the account link is gone.');
console.log('\n  This wrote the file on disk. The RUNNING server still has the old copy in memory');
console.log('  until it restarts — restart it for this to take effect on live requests.\n');
