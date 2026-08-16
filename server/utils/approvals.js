// server/utils/approvals.js
// Who may approve correspondence for which department, and which departments a
// user can see. Both questions have exactly one answer here so the API, the
// badge counts and the UI can never drift apart.
//
// A department's رئيس القسم and نائب are stored on the department in
// departments.json, not on the user row. That is deliberate: the users table has
// a single dept_id, but several people genuinely head two departments at once
// (علي محمد قمبر heads الموارد البشرية and الخدمات الإدارية; علي عبدالرحمن مطر
// heads الحسابات and الاستثمارات الوقفية). Keying off the department lets one
// account carry authority in several places without duplicating the user.
//
// Current rule, agreed with SWD: the head and the deputy are PEERS — either may
// approve, at any time, with no absence tracking. When an absence/delegation
// rule is decided later, `approversOf()` is the only function that changes.
const { readConfig } = require('../services/configService');
const { db } = require('../db');

// Only مدير النظام (IT) sees across every department. ADMIN used to be in
// this list, but SWD's role model is four levels — مدير النظام, رئيس القسم,
// النائب, موظف — where النائب is a DEPARTMENT deputy, not an org-wide
// overseer. ADMIN now carries that meaning and is department-scoped.
const ADMIN_ROLES = ['SUPER_ADMIN'];

// Roles that approve for their own department when named on it by dept_id.
// رئيس القسم and النائب do the same things and approve the same, per SWD.
const DEPT_APPROVER_ROLES = ['MANAGER', 'ADMIN'];

function isAdmin(user) {
  return ADMIN_ROLES.includes(user?.role);
}

// Case-insensitive because AD usernames arrive with inconsistent casing.
function sameUser(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// The usernames allowed to approve on behalf of a department. Entries whose
// `username` is still null (person has no account yet) are skipped rather than
// matching everyone.
function approversOf(deptId) {
  const { departments = [] } = readConfig();
  const dept = departments.find(d => d.id === deptId);
  if (!dept) return [];
  return [dept.head, dept.deputy]
    .filter(Boolean)
    .map(p => p.username)
    .filter(Boolean);
}

// Every department this user holds a head/deputy slot for. Usually empty, one
// for most managers, two for the dual-role supervisors.
function ledDepartments(user) {
  if (!user?.username) return [];
  const { departments = [] } = readConfig();
  return departments
    .filter(d => approversOf(d.id).some(u => sameUser(u, user.username)))
    .map(d => d.id);
}

/**
 * May this user approve/reject correspondence ORIGINATING from `deptId`?
 * Three independent paths, any one of which is enough:
 *   1. ADMIN or SUPER_ADMIN — bypasses everything.
 *   2. Named as head or deputy of that department in departments.json.
 *   3. Role MANAGER with dept_id equal to that department — the manual path a
 *      Super Admin uses for departments that have no directory entry, or only
 *      one person listed.
 */
function canApproveFor(user, deptId) {
  if (!deptId) return false;
  if (isAdmin(user)) return true;
  if (approversOf(deptId).some(u => sameUser(u, user?.username))) return true;
  return DEPT_APPROVER_ROLES.includes(user?.role) && user?.dept_id === deptId;
}

// Departments whose queues this user acts on: their own, plus any they lead.
function myDepartments(user) {
  const set = new Set(ledDepartments(user));
  if (user?.dept_id) set.add(user.dept_id);
  return [...set];
}

// True if the user approves for at least one department — i.e. they get the
// department-wide view rather than the "only what I sent" view.
function isApprover(user) {
  if (isAdmin(user)) return true;
  if (ledDepartments(user).length) return true;
  return DEPT_APPROVER_ROLES.includes(user?.role) && !!user?.dept_id;
}

/**
 * A department nobody can act on — no head or deputy whose username matches an
 * active account. Without somewhere to fall, its correspondence would sit
 * pending forever, so these land in مدير النظام's queue.
 */
function departmentsWithoutApprover() {
  const { departments = [] } = readConfig();
  const active = new Set(
    db.prepare('SELECT username FROM users WHERE is_active = 1').all()
      .map(u => String(u.username).toLowerCase())
  );
  return departments
    .filter(d => !approversOf(d.id).some(u => active.has(String(u).toLowerCase())))
    .map(d => d.id);
}

/**
 * Which departments' pending correspondence belongs in this user's الموافقات.
 *
 * Deliberately NOT the same question as canApproveFor(). مدير النظام *may*
 * approve for any department — that is the fallback that stops anything getting
 * permanently stuck — but that is authority, not work. Putting all 22
 * departments in the queue meant every IT account inherited the whole
 * organisation's approvals, including their badge count, for correspondence
 * between two departments they have nothing to do with.
 *
 * So an admin's queue is what they actually lead, plus any department that
 * nobody else can act on. Everything else stays approvable by opening it.
 */
function approvalQueueFor(user) {
  const { departments = [] } = readConfig();
  if (!isAdmin(user)) {
    return departments.map(d => d.id).filter(id => canApproveFor(user, id));
  }
  return [...new Set([...ledDepartments(user), ...departmentsWithoutApprover()])];
}

/**
 * SQL fragment scoping a correspondence query to what this user may read.
 * Returns { clause, params } — clause is null when the user sees everything.
 *
 *   admin              → everything
 *   head/deputy/manager→ anything from or to a department they act for
 *   everyone else      → what they sent, or what is addressed to their department
 *
 * The same fragment is used by the list, the single-record read and the badge
 * counts, so a record can never appear in a list the user cannot open.
 */
function visibilityClause(user, table = 'c') {
  if (isAdmin(user)) return { clause: null, params: [] };

  const depts = myDepartments(user);
  const inList = depts.length ? depts.map(() => '?').join(',') : null;

  if (isApprover(user) && inList) {
    return {
      clause: `(${table}.from_dept_id IN (${inList}) OR ${table}.to_dept_id IN (${inList}))`,
      params: [...depts, ...depts],
    };
  }

  if (inList) {
    return {
      clause: `(${table}.from_user_id = ? OR ${table}.to_dept_id IN (${inList}))`,
      params: [user?.id ?? -1, ...depts],
    };
  }

  // No department at all — the user only ever sees what they sent themselves.
  return { clause: `${table}.from_user_id = ?`, params: [user?.id ?? -1] };
}

module.exports = {
  isAdmin,
  departmentsWithoutApprover,
  approvalQueueFor,
  DEPT_APPROVER_ROLES,
  sameUser,
  approversOf,
  ledDepartments,
  canApproveFor,
  myDepartments,
  isApprover,
  visibilityClause,
};
