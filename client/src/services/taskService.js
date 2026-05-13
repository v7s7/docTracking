import { getToken } from './authService';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5050';

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
export const returnTask  = (id, body)    => req(`/tasks/${id}/return`, { method: 'POST', body: JSON.stringify(body) });
export const closeTask   = (id, body)    => req(`/tasks/${id}/close`, { method: 'POST', body: JSON.stringify(body) });
export const addComment   = (id, note)    => req(`/tasks/${id}/comment`, { method: 'POST', body: JSON.stringify({ note }) });
export const getDashboard = (params = {}) => req(`/dashboard?${new URLSearchParams(params)}`);
export const bulkAction   = (body)        => req('/tasks/bulk', { method: 'POST', body: JSON.stringify(body) });
