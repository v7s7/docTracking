// server/utils/circularAuth.js
// Who may publish a تعميم, and which department each تعميم belongs to.
//
// A تعميم is signed by an office, not by a department queue, so authority is
// exactly: the رئيس or the نائب named on that office in config/departments.json.
// Nothing else. Deliberately NOT canApproveFor() from ./approvals — that helper
// carries `if (isAdmin(user)) return true`, which would let every مدير النظام
// account (and, via effectiveRole(), everyone in تقنية المعلومات) sign a تعميم
// in the Director General's name. SWD asked for the opposite: مدير النظام is a
// role for running the system, not a licence to speak for another office.
//
// Consequence, and it is intentional: an office with no head/deputy filled in
// has NO publisher, and POST /circulars will refuse for that source. At the time
// of writing مكتب نائب الرئيس is exactly that case — it was added to
// departments.json without contact details, so تعميم نائب الرئيس cannot be
// published until someone is named. Filling in `head` / `deputy` there is a
// config edit; no code changes.
const { approversOf, sameUser } = require('./approvals');

// Ids double as the `source` column value in the circulars table, and the
// CHECK constraint there must be kept in step with this list.
const SOURCES = ['deputy_chairman', 'director_general'];

// source → the office in config/departments.json whose head/deputy signs it.
// NOTE the mismatch, it is deliberate: the Deputy Chairman's office is stored
// under the id 'board_office'. That id predates the correct label and is
// referenced by live user rows and a chat conversation, so it was left alone
// while the label was fixed to «مكتب نائب الرئيس». Renaming the id would strand
// that data. Read the label, never the id, when showing this to a person.
const SOURCE_DEPT = {
  deputy_chairman:  'board_office',
  director_general: 'director_general_office',
};

// source → serial prefix, e.g. DC-2026-0001 / DG-2026-0001.
const SOURCE_CODE = {
  deputy_chairman:  'DC',
  director_general: 'DG',
};

function isSource(source) {
  return SOURCES.includes(source);
}

function deptOfSource(source) {
  return SOURCE_DEPT[source] || null;
}

/**
 * May this user publish a تعميم of this kind?
 * True only when their username is the head or the deputy of the signing office.
 * approversOf() already drops entries whose username is null, so an office with
 * a name but no account does not accidentally match everybody.
 */
function canPublishCircular(user, source) {
  if (!isSource(source) || !user?.username) return false;
  return approversOf(SOURCE_DEPT[source]).some(u => sameUser(u, user.username));
}

/** The kinds this user may publish — sent to the client so it can show the compose button. */
function publishableSources(user) {
  return SOURCES.filter(s => canPublishCircular(user, s));
}

/**
 * May this user edit or delete an existing تعميم?
 * The publisher themselves, or anyone who currently signs for that office — so a
 * تعميم does not become uneditable the day its author leaves.
 */
function canModifyCircular(user, row) {
  if (!row) return false;
  if (user?.id && row.published_by_id && user.id === row.published_by_id) return true;
  return canPublishCircular(user, row.source);
}

module.exports = {
  SOURCES,
  SOURCE_DEPT,
  SOURCE_CODE,
  isSource,
  deptOfSource,
  canPublishCircular,
  publishableSources,
  canModifyCircular,
};
