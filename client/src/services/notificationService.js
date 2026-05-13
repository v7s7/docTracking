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

export const getNotifications = ()   => req('/notifications');
export const markAllRead      = ()   => req('/notifications/read', { method: 'POST' });
export const markOneRead      = (id) => req(`/notifications/${id}/read`, { method: 'POST' });
