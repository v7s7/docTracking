import { getToken } from './authService';

export const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5050';

async function req(path, opts = {}) {
  const res  = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}`, ...opts.headers },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export const getDirectory     = ()        => req('/messages/directory');
export const getConversations = ()        => req('/messages/conversations');
export const openDM           = (userId)  => req(`/messages/dm/${userId}`, { method: 'POST' });
export const markRead         = (convId)  => req(`/messages/conversations/${convId}/read`, { method: 'POST' });
export const getUnreadCount   = ()        => req('/messages/unread-count');
export const sendPresence     = ()        => req('/messages/presence', { method: 'POST' });

export const getMessages = (convId, after) =>
  req(`/messages/conversations/${convId}/messages${after ? `?after=${after}` : ''}`);

export function sendMessage(convId, { content, file }) {
  const form = new FormData();
  if (content) form.append('content', content);
  if (file)    form.append('file', file);
  return req(`/messages/conversations/${convId}/messages`, { method: 'POST', body: form });
}

export function fileUrl(path) {
  return `${BASE}${path}`;
}
