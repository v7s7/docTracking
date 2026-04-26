// server/utils/roleMapper.js
// Reads group→role mappings from the live config file so Super Admin
// changes in the panel take effect on the next user login — no restart needed.
const { readConfig } = require('../services/configService');

// Extracts the CN value from a full LDAP Distinguished Name.
// e.g. "CN=Accounts_Dept,OU=Groups,DC=swd,DC=local" → "accounts_dept"
function extractCN(dn) {
  const match = String(dn).match(/^CN=([^,]+)/i);
  return match ? match[1].toLowerCase() : null;
}

const ROLE_PRIORITY = ['READONLY', 'STAFF', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Maps an array of LDAP memberOf DNs to the single highest internal role.
 * Falls back to STAFF for any successfully authenticated AD user.
 * The mapping table is read from departments.json on each call (cached in memory).
 */
function mapGroupsToRole(memberOf = []) {
  const { roleGroupMap = {} } = readConfig();
  let highest = 'STAFF';

  for (const dn of memberOf) {
    const cn = extractCN(dn);
    if (!cn) continue;
    const mapped = roleGroupMap[cn];
    if (!mapped) continue;
    if (ROLE_PRIORITY.indexOf(mapped) > ROLE_PRIORITY.indexOf(highest)) {
      highest = mapped;
    }
  }

  return highest;
}

// Returns plain group CN names — used in the JWT payload for audit logging
function extractGroupNames(memberOf = []) {
  return memberOf.map(extractCN).filter(Boolean);
}

module.exports = { mapGroupsToRole, extractGroupNames };
