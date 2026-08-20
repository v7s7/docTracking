// server/utils/permissions.js
//
// Who may administer user accounts, and how far that reaches.
//
// Two administrators, deliberately unequal:
//
//   مدير النظام (SUPER_ADMIN)  — IT. Everything: create, delete, any role.
//   الموارد البشرية            — HR. The organisational half of the job:
//                                who reports where, who is a رئيس قسم, who has
//                                joined and who has left, and everyone's desk
//                                extension. Not the technical half.
//
// The separation is the point, not an inconvenience. HR owns organisational
// facts; IT owns access to the system. So HR cannot:
//
//   • grant or remove مدير النظام — otherwise an HR account can promote itself
//     to full system administrator, and the split is decorative
//   • touch an account that already holds مدير النظام
//   • create or delete accounts — those are technical operations, and a delete
//     takes the person's history with it
//   • change their own role or switch themselves off — the ordinary
//     separation-of-duties rule: you do not sign your own promotion
//
// Everything here is checked server-side. The UI hides what a user cannot do,
// but hiding is a courtesy; this file is the rule.
const HR_DEPT_ID = process.env.HR_DEPT_ID || 'hr_dept';
// تقنية المعلومات. Everyone in it is مدير النظام — SWD runs IT as a team, and a
// permission that only one person holds is a permission that stops working the
// week he is on leave.
const IT_DEPT_ID = process.env.IT_DEPT_ID || 'it_dept';

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

// Everything except مدير النظام. HR assigns رئيس قسم, النائب and موظف freely —
// those are organisational posts, which is exactly HR's remit.
const HR_ASSIGNABLE_ROLES = ALL_ROLES.filter(r => r !== 'SUPER_ADMIN');

function isSystemAdmin(user) {
  return user?.role === 'SUPER_ADMIN';
}

// Usernames forced to مدير النظام by SUPER_ADMIN_USERS in .env, whatever their
// stored role says. This is the lockout failsafe, so it has to be read here too.
function overrideAdmins() {
  return (process.env.SUPER_ADMIN_USERS || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

function isOverrideAdmin(row) {
  const u = String(row?.username || '').toLowerCase();
  const e = String(row?.email || '').toLowerCase();
  return overrideAdmins().some(x => x === u || (e && x === e));
}

function isItDepartment(row) {
  return String(row?.dept_id || '') === IT_DEPT_ID;
}

/**
 * The role a stored row actually carries at runtime. THE single definition —
 * both login paths and the per-request refresh call this, so a person cannot
 * end up with one role in their token and another in the middleware.
 *
 * Three ways to be مدير النظام:
 *   1. the stored role says so
 *   2. SUPER_ADMIN_USERS names them — the lockout failsafe, which no UI can remove
 *   3. they are in تقنية المعلومات — IT is a team, not one person
 */
function effectiveRole(row) {
  if (!row) return 'STAFF';
  if (row.role === 'SUPER_ADMIN' || isOverrideAdmin(row) || isItDepartment(row)) return 'SUPER_ADMIN';
  return row.role || 'STAFF';
}

/**
 * Is this *stored row* an IT account that HR must not touch?
 *
 * Checking `role === 'SUPER_ADMIN'` alone is not enough, and the gap is not
 * hypothetical: at SWD nobody holds SUPER_ADMIN in the users table at all —
 * a.alkubaesy is مدير النظام purely through SUPER_ADMIN_USERS, and his row
 * still reads STAFF. Without this, HR could demote him, move him out of
 * تقنية المعلومات, or deactivate him — and a deactivated account is refused at
 * the door regardless of the override, so that last one locks IT out of the
 * only screen that could undo it.
 */
function isProtectedAccount(row) {
  return effectiveRole(row) === 'SUPER_ADMIN';
}

// Anyone in الموارد البشرية. The department is read from the live user row on
// every request by authMiddleware, so moving someone out of HR removes this on
// their next click — no logout, no cache to clear.
function isHrAdmin(user) {
  if (!user || isSystemAdmin(user)) return false;
  return String(user.dept_id || '') === HR_DEPT_ID;
}

function canManageUsers(user) {
  return isSystemAdmin(user) || isHrAdmin(user);
}

function assignableRoles(actor) {
  return isSystemAdmin(actor) ? ALL_ROLES : HR_ASSIGNABLE_ROLES;
}

/**
 * May `actor` modify `target`? Returns null when allowed, or the reason it is
 * refused — the caller turns that into a 403 message the user can act on.
 */
function refuseEdit(actor, target, patch = {}) {
  if (isSystemAdmin(actor)) return null;
  if (!isHrAdmin(actor)) return 'You do not have permission to change user accounts.';

  if (isProtectedAccount(target)) {
    return 'This is a system administrator account. Only IT can change it.';
  }
  if (patch.role !== undefined && !HR_ASSIGNABLE_ROLES.includes(patch.role)) {
    return 'Only IT can grant the System Administrator role.';
  }
  // Moving an account into تقنية المعلومات IS a promotion — effectiveRole() grants
  // مدير النظام by department — so a department change is a role change wearing a
  // different name. This gated patch.role and never looked at patch.dept_id, which
  // let any HR user hand themselves full admin in a single request.
  if (patch.dept_id !== undefined && String(patch.dept_id) === IT_DEPT_ID
      && String(target?.dept_id || '') !== IT_DEPT_ID) {
    return 'Only IT can move an account into تقنية المعلومات.';
  }
  // You do not sign your own promotion. Contact details are still fine.
  if (actor?.id && target?.id && Number(actor.id) === Number(target.id)) {
    if (patch.role !== undefined && patch.role !== target.role) {
      return 'You cannot change your own role. Ask IT.';
    }
    if (patch.is_active !== undefined && !patch.is_active) {
      return 'You cannot deactivate your own account.';
    }
    if (patch.dept_id !== undefined && String(patch.dept_id) !== String(target.dept_id || '')) {
      return 'You cannot change your own department. Ask IT.';
    }
  }
  return null;
}

/** Express guard for routes both administrators share. */
function requireUserAdmin(req, res, next) {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to manage users.' });
  }
  next();
}

/** Express guard for the IT-only routes: create, delete, Active Directory. */
function requireSystemAdmin(req, res, next) {
  if (!isSystemAdmin(req.user)) {
    return res.status(403).json({ success: false, message: 'Only IT can do this.' });
  }
  next();
}

/** What the caller may do, for the UI to shape itself around. */
function capabilities(user) {
  const sysAdmin = isSystemAdmin(user);
  const hr = isHrAdmin(user);
  return {
    manageUsers:    sysAdmin || hr,
    createUsers:    sysAdmin,
    deleteUsers:    sysAdmin,
    browseDirectory: sysAdmin,        // the live Active Directory browse
    assignableRoles: assignableRoles(user),
    editOwnRole:    sysAdmin,
    scope:          sysAdmin ? 'system' : hr ? 'hr' : 'none',
  };
}

module.exports = {
  HR_DEPT_ID, IT_DEPT_ID, ALL_ROLES, HR_ASSIGNABLE_ROLES,
  isSystemAdmin, isHrAdmin, isItDepartment, isOverrideAdmin, effectiveRole,
  isProtectedAccount, canManageUsers, assignableRoles,
  refuseEdit, requireUserAdmin, requireSystemAdmin, capabilities,
};
