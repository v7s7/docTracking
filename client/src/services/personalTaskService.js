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

export const getPersonalTasks   = ()        => req('/personal-tasks');
export const createPersonalTask = (body)    => req('/personal-tasks', { method: 'POST', body: JSON.stringify(body) });
export const updatePersonalTask = (id, body) => req(`/personal-tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deletePersonalTask = (id)      => req(`/personal-tasks/${id}`, { method: 'DELETE' });
