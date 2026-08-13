// server/utils/serviceScope.js
// Which request types (services) a department is allowed to send to another
// department. A service may carry `fromDepts: [deptId, ...]`; omitted or empty
// means any department may request it. Used by both the correspondence API
// (to validate a submitted service id) and the department listing the UI reads,
// so the dropdown and the server agree on exactly one rule.
const { readConfig } = require('../services/configService');

// The catch-all option every department always has. It is not stored in
// departments.json — picking it means the sender types their own subject.
const OTHER_SERVICE_ID = 'other';

function isServiceAllowedFrom(service, fromDeptId) {
  const scope = service?.fromDepts;
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.includes(fromDeptId);
}

// Every department, with each one's services narrowed to what `fromDeptId` may
// request. The sender's own department is excluded — a department never sends
// correspondence to itself.
function requestableDepartments(fromDeptId) {
  const { departments = [] } = readConfig();
  return departments
    .filter(d => d.id !== fromDeptId)
    .map(d => ({
      id:       d.id,
      label:    d.label,
      services: (d.services || [])
        .filter(s => isServiceAllowedFrom(s, fromDeptId))
        .map(s => ({ id: s.id, label: s.label, description: s.description || '' })),
    }));
}

// Resolves a submitted (toDeptId, serviceId) pair to the subject line, or
// returns { error } if the sender may not use that service. `customSubject` is
// required when serviceId is OTHER_SERVICE_ID and ignored otherwise, so a
// caller can never smuggle in a free-text subject under a real service id.
function resolveSubject({ fromDeptId, toDeptId, serviceId, customSubject }) {
  if (!toDeptId)             return { error: 'القسم المستلم مطلوب.' };
  if (toDeptId === fromDeptId) return { error: 'لا يمكن إرسال مراسلة إلى نفس القسم.' };

  const { departments = [] } = readConfig();
  const toDept = departments.find(d => d.id === toDeptId);
  if (!toDept) return { error: 'القسم المستلم غير موجود.' };

  if (!serviceId || serviceId === OTHER_SERVICE_ID) {
    const subject = String(customSubject || '').trim();
    if (!subject) return { error: 'الموضوع مطلوب.' };
    return { subject, serviceId: OTHER_SERVICE_ID, serviceLabel: '' };
  }

  const service = (toDept.services || []).find(s => s.id === serviceId);
  if (!service) return { error: 'نوع الطلب غير موجود لدى القسم المستلم.' };
  if (!isServiceAllowedFrom(service, fromDeptId)) {
    return { error: 'نوع الطلب غير متاح لقسمك.' };
  }
  return { subject: service.label, serviceId: service.id, serviceLabel: service.label };
}

module.exports = {
  OTHER_SERVICE_ID,
  isServiceAllowedFrom,
  requestableDepartments,
  resolveSubject,
};
