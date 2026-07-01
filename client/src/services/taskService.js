import { getToken } from './authService';

const BASE = process.env.REACT_APP_API_URL || '';

async function req(path, opts = {}) {
  const res  = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export const getTasks    = (params = {}) => req(`/tasks?${new URLSearchParams(params)}`);
export const getTask     = (id)          => req(`/tasks/${id}`);
export const createTask  = (body)        => req('/tasks', { method: 'POST', body: JSON.stringify(body) });
export const updateTask  = (id, body)    => req(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const forwardTask = (id, body)    => req(`/tasks/${id}/forward`, { method: 'POST', body: JSON.stringify(body) });
export const acceptTask  = (id)          => req(`/tasks/${id}/accept`, { method: 'POST', body: JSON.stringify({}) });
export const returnTask  = (id, body)    => req(`/tasks/${id}/return`, { method: 'POST', body: JSON.stringify(body) });
export const closeTask   = (id, body)    => req(`/tasks/${id}/close`, { method: 'POST', body: JSON.stringify(body) });
export const addComment   = (id, note, tagged_dept_id) => req(`/tasks/${id}/comment`, { method: 'POST', body: JSON.stringify({ note, tagged_dept_id: tagged_dept_id || undefined }) });
export const getDashboard = (params = {}) => req(`/dashboard?${new URLSearchParams(params)}`);
export const bulkAction   = (body)        => req('/tasks/bulk', { method: 'POST', body: JSON.stringify(body) });

export function exportTasks(params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE}/tasks/export${qs ? '?' + qs : ''}`;
  fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
}
