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

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

// Everything except مدير النظام. HR assigns رئيس قسم, النائب and موظف freely —
// those are organisational posts, which is exactly HR's remit.
const HR_ASSIGNABLE_ROLES = ALL_ROLES.filter(r => r !== 'SUPER_ADMIN');

function isSystemAdmin(user) {
  return user?.role === 'SUPER_ADMIN';
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

  if (target?.role === 'SUPER_ADMIN') {
    return 'This is a system administrator account. Only IT can change it.';
  }
  if (patch.role !== undefined && !HR_ASSIGNABLE_ROLES.includes(patch.role)) {
    return 'Only IT can grant the System Administrator role.';
  }
  // You do not sign your own promotion. Contact details are still fine.
  if (actor?.id && target?.id && Number(actor.id) === Number(target.id)) {
    if (patch.role !== undefined && patch.role !== target.role) {
      return 'You cannot change your own role. Ask IT.';
    }
    if (patch.is_active !== undefined && !patch.is_active) {
      return 'You cannot deactivate your own account.';
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
  HR_DEPT_ID, ALL_ROLES, HR_ASSIGNABLE_ROLES,
  isSystemAdmin, isHrAdmin, canManageUsers, assignableRoles,
  refuseEdit, requireUserAdmin, requireSystemAdmin, capabilities,
};
