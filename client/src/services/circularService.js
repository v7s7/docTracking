import { getToken } from './authService';

// Mirrors correspondenceService.js deliberately — there is no shared HTTP client
// in this codebase, and inventing one here would leave two conventions instead
// of the current single copied-by-hand one.
const BASE = process.env.REACT_APP_API_URL || '';

async function req(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      // The browser must set the multipart boundary itself.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${getToken()}`,
      ...opts.headers,
    },
    ...opts,
  });
  // Read defensively. A 502, a restart mid-request or a dropped connection
  // returns HTML or nothing at all, and res.json() then throws its own English
  // message — "Failed to fetch" — straight into an Arabic red alert.
  let data = {};
  try { data = await res.json(); } catch (_) { /* not JSON — fall through */ }
  if (!res.ok) throw new Error(data.message || 'تعذر تنفيذ الطلب');
  return data;
}

function toForm({ source, title, body, files = [] }) {
  const form = new FormData();
  if (source) form.append('source', source);
  form.append('title', title || '');
  form.append('body', body || '');
  files.forEach(f => form.append('attachments', f));
  return form;
}

export const listCirculars = (params = {}) =>
  req(`/circulars?${new URLSearchParams(params)}`);

export const getCircular   = id => req(`/circulars/${id}`);
export const getCircStats  = ()  => req('/circulars/stats');
export const getCircReaders = id => req(`/circulars/${id}/readers`);

export const publishCircular = payload =>
  req('/circulars', { method: 'POST', body: toForm(payload) });

export const updateCircular = (id, payload) =>
  req(`/circulars/${id}`, { method: 'PUT', body: toForm(payload) });

export const deleteCircular = id =>
  req(`/circulars/${id}`, { method: 'DELETE' });

export const markCircularRead = id =>
  req(`/circulars/${id}/read`, { method: 'POST', body: JSON.stringify({}) });

// Attachments are behind auth, so they cannot be a plain href — fetch the blob
// with the token attached and hand it to the browser as a download.
export async function downloadCircularAttachment(circularId, attId, fileName) {
  const res = await fetch(`${BASE}/circulars/${circularId}/attachments/${attId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    let message = 'تعذر تنزيل المرفق';
    try { message = (await res.json()).message || message; } catch (_) {}
    throw new Error(message);
  }
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
