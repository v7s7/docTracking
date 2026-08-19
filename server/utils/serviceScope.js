// server/utils/serviceScope.js
// Which subjects a department may put on a correspondence to another department.
//
// TWO DIRECTIONS, because SWD's traffic genuinely runs both ways:
//
//   `services`  — things a department RECEIVES. Request types it accepts.
//                 `fromDepts: [...]` limits who may ask; omitted means anyone.
//                 e.g. الموارد البشرية accepts نقولات from المساجد.
//
//   `outgoing`  — things a department ISSUES. Notices and instructions it sends.
//                 `toDepts: [...]` limits who may receive; omitted means everyone.
//                 e.g. التخطيط الاستراتيجي issues تحديث إجراءات الجودة to all.
//
// When someone composes to a department, the dropdown is the union: what that
// recipient accepts from me, plus what my own department issues to them. Both
// the listing the UI reads and the server-side validation come from the same
// function here, so the dropdown and the server can never disagree.
const { readConfig } = require('../services/configService');

// The catch-all option every department always has. It is not stored in
// departments.json — picking it means the sender types their own subject.
const OTHER_SERVICE_ID = 'other';

// An empty or absent scope list means "no restriction", for both directions.
function inScope(list, id) {
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.includes(id);
}

const isServiceAllowedFrom = (service, fromDeptId) => inScope(service?.fromDepts, fromDeptId);
const isOutgoingAllowedTo  = (service, toDeptId)   => inScope(service?.toDepts,   toDeptId);

/**
 * Every subject `fromDeptId` may use when writing to `toDept`.
 * Each entry carries `direction` so the UI can group them if it ever wants to:
 *   'request' — I am asking the recipient for something
 *   'issue'   — my department is sending them something it owns
 */
function servicesBetween(fromDept, toDept) {
  const requests = (toDept?.services || [])
    .filter(s => isServiceAllowedFrom(s, fromDept?.id))
    .map(s => ({ id: s.id, label: s.label, description: s.description || '', direction: 'request' }));

  const issues = (fromDept?.outgoing || [])
    .filter(s => isOutgoingAllowedTo(s, toDept?.id))
    .map(s => ({ id: s.id, label: s.label, description: s.description || '', direction: 'issue' }));

  // A department's own outgoing wins if an id ever collides, since that is the
  // list its own people expect to see.
  const seen = new Set(issues.map(s => s.id));
  return [...issues, ...requests.filter(s => !seen.has(s.id))];
}

// Every department, with each one's subjects narrowed to what `fromDeptId` may
// use. The sender's own department is excluded — a department never sends
// correspondence to itself.
function requestableDepartments(fromDeptId) {
  const { departments = [] } = readConfig();
  const fromDept = departments.find(d => d.id === fromDeptId);
  return departments
    .filter(d => d.id !== fromDeptId)
    .map(d => ({ id: d.id, label: d.label, services: servicesBetween(fromDept, d) }));
}

// Resolves a submitted (toDeptId, serviceId) pair to the subject line, or
// returns { error } if the sender may not use that service. `customSubject` is
// required when serviceId is OTHER_SERVICE_ID and ignored otherwise, so a
// caller can never smuggle in a free-text subject under a real service id.
function resolveSubject({ fromDeptId, toDeptId, serviceId, customSubject }) {
  if (!toDeptId)               return { error: 'القسم المستلم مطلوب.' };
  if (toDeptId === fromDeptId) return { error: 'لا يمكن إرسال مراسلة إلى نفس القسم.' };

  const { departments = [] } = readConfig();
  const toDept   = departments.find(d => d.id === toDeptId);
  const fromDept = departments.find(d => d.id === fromDeptId);
  if (!toDept) return { error: 'القسم المستلم غير موجود.' };

  if (!serviceId || serviceId === OTHER_SERVICE_ID) {
    const subject = String(customSubject || '').trim();
    if (!subject) return { error: 'الموضوع مطلوب.' };
    return { subject, serviceId: OTHER_SERVICE_ID, serviceLabel: '' };
  }

  // Validated against exactly the list the composer was given — not against the
  // recipient's services alone, which would reject every outgoing subject.
  const service = servicesBetween(fromDept, toDept).find(s => s.id === serviceId);
  if (!service) return { error: 'نوع الطلب غير متاح بين القسمين.' };
  return { subject: service.label, serviceId: service.id, serviceLabel: service.label };
}

module.exports = {
  OTHER_SERVICE_ID,
  isServiceAllowedFrom,
  isOutgoingAllowedTo,
  servicesBetween,
  requestableDepartments,
  resolveSubject,
};
