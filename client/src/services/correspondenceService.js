import { getToken } from './authService';

const BASE = process.env.REACT_APP_API_URL || '';

async function req(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      // Let the browser set the multipart boundary itself — setting
      // Content-Type by hand on a FormData body breaks the upload.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${getToken()}`,
      ...opts.headers,
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'تعذر تنفيذ الطلب');
  return data;
}

function toForm({ to_dept_id, service_id, subject, body, priority, files = [] }) {
  const form = new FormData();
  form.append('to_dept_id', to_dept_id || '');
  form.append('service_id', service_id || '');
  form.append('subject', subject || '');
  form.append('body', body || '');
  form.append('priority', priority || 'med');
  files.forEach(f => form.append('attachments', f));
  return form;
}

export const listCorrespondence = (params = {}) =>
  req(`/correspondence?${new URLSearchParams(params)}`);

export const getCorrespondence = id => req(`/correspondence/${id}`);
export const getCorrStats      = ()  => req('/correspondence/stats');

export const createCorrespondence = payload =>
  req('/correspondence', { method: 'POST', body: toForm(payload) });

export const updateCorrespondence = (id, payload) =>
  req(`/correspondence/${id}`, { method: 'PUT', body: toForm(payload) });

export const approveCorrespondence = id =>
  req(`/correspondence/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });

export const rejectCorrespondence = (id, reason) =>
  req(`/correspondence/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });

export const completeCorrespondence = id =>
  req(`/correspondence/${id}/complete`, { method: 'POST', body: JSON.stringify({}) });

// Departments the caller may send to, with request types already filtered to
// what their own department is allowed to ask for.
export const getRequestableDepartments = () => req('/departments/requestable');

// Attachments are NOT served statically — they come through an authorised
// route, so the download needs the bearer token and a blob hand-off.
export async function downloadAttachment(corrId, attId, fileName) {
  const res = await fetch(`${BASE}/correspondence/${corrId}/attachments/${attId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('تعذر تنزيل المرفق');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = fileName || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Header-bell feed for correspondence. Kept separate from /notifications
// because that table is bound to `tasks` by a NOT NULL foreign key.
export const getCorrNotifications  = () => req('/correspondence/notifications');
export const markCorrNotifications = () =>
  req('/correspondence/notifications/read', { method: 'POST', body: JSON.stringify({}) });

// Opens (or finds) the direct conversation about this memo and returns its id.
export const discussCorrespondence = id =>
  req(`/correspondence/${id}/discuss`, { method: 'POST', body: JSON.stringify({}) });

export const getCorrReports = (params = {}) =>
  req(`/correspondence/reports?${new URLSearchParams(params)}`);

// Streams the archive as a CSV download. Not JSON, so it bypasses `req`.
export async function exportArchive(params = {}) {
  const res = await fetch(`${BASE}/correspondence/export?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('تعذر تصدير الأرشيف');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `correspondence-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
