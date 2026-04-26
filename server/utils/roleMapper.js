// server/utils/roleMapper.js

// Extracts the CN value from a full LDAP Distinguished Name.
// e.g. "CN=Accounts_Dept,OU=Groups,DC=swd,DC=local" → "accounts_dept"
function extractCN(dn) {
  const match = String(dn).match(/^CN=([^,]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// ─── Group → Role mapping ───────────────────────────────────────────────────
// Keys are LDAP group CNs (lowercase). Update these to match your AD groups.
// Any authenticated AD user who is not in a mapped group defaults to STAFF.
const GROUP_ROLE_MAP = {
  // ── ADMIN: full system access + user management
  'domain admins':      'ADMIN',
  'it_dept':            'ADMIN',
  'system_admins':      'ADMIN',
  'it_administrators':  'ADMIN',

  // ── MANAGER: approve/reject workflows, view all department docs
  'managers':           'MANAGER',
  'dept_managers':      'MANAGER',
  'supervisors':        'MANAGER',
  'senior_staff':       'MANAGER',

  // ── STAFF: create & track own documents, limited cross-dept visibility
  'accounts_dept':      'STAFF',
  'hr_dept':            'STAFF',
  'legal_dept':         'STAFF',
  'operations_dept':    'STAFF',
  'finance_dept':       'STAFF',
  'it_support':         'STAFF',
  'general_staff':      'STAFF',

  // ── READONLY: audit trail access only
  'audit_team':         'READONLY',
  'external_auditors':  'READONLY',
  'compliance':         'READONLY',
};

// Higher index = higher privilege. Used to pick the best role when a user
// belongs to multiple groups at different levels.
const ROLE_PRIORITY = ['READONLY', 'STAFF', 'MANAGER', 'ADMIN'];

/**
 * Maps an array of LDAP memberOf DNs to the single highest internal role.
 * Falls back to STAFF for any successfully authenticated AD user.
 */
function mapGroupsToRole(memberOf = []) {
  let highest = 'STAFF'; // default for all valid AD users

  for (const dn of memberOf) {
    const cn = extractCN(dn);
    if (!cn) continue;
    const mapped = GROUP_ROLE_MAP[cn];
    if (!mapped) continue;
    if (ROLE_PRIORITY.indexOf(mapped) > ROLE_PRIORITY.indexOf(highest)) {
      highest = mapped;
    }
  }

  return highest;
}

// Returns plain group CN names (useful for token payload / audit logging)
function extractGroupNames(memberOf = []) {
  return memberOf.map(extractCN).filter(Boolean);
}

module.exports = { mapGroupsToRole, extractGroupNames };
