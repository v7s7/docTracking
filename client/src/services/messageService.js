import { getToken } from './authService';

export const BASE = process.env.REACT_APP_API_URL || '';

async function req(path, opts = {}) {
  const res  = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, ...opts.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export const getDirectory     = ()        => req('/messages/directory');
export const getConversations = ()        => req('/messages/conversations');
export const openDM           = (userId)  => req(`/messages/dm/${userId}`, { method: 'POST' });
export const startGroupChat   = (memberIds) => req('/messages/group', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ memberIds }),
});
export const markRead         = (convId)  => req(`/messages/conversations/${convId}/read`, { method: 'POST' });
export const hideConversation   = (convId) => req(`/messages/conversations/${convId}/hide`,   { method: 'POST' });
export const unhideConversation = (convId) => req(`/messages/conversations/${convId}/unhide`, { method: 'POST' });
export const getUnreadCount   = ()        => req('/messages/unread-count');
export const sendPresence     = (status = 'active') => req('/messages/presence', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status }),
});

export const getMessages = (convId, after) =>
  req(`/messages/conversations/${convId}/messages${after ? `?after=${after}` : ''}`);

export const getConversationMembers = (convId) => req(`/messages/conversations/${convId}/members`);

export const getReadStatus = (convId) => req(`/messages/conversations/${convId}/read-status`);

export const sendTyping = (convId) => req(`/messages/conversations/${convId}/typing`, { method: 'POST' });

export const toggleReaction = (convId, msgId, emoji) => req(`/messages/conversations/${convId}/messages/${msgId}/react`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ emoji }),
});

export const getPinnedMessage = (convId) => req(`/messages/conversations/${convId}/pinned`);
export const pinMessage   = (convId, msgId) => req(`/messages/conversations/${convId}/messages/${msgId}/pin`,   { method: 'POST' });
export const unpinMessage = (convId, msgId) => req(`/messages/conversations/${convId}/messages/${msgId}/unpin`, { method: 'POST' });

export const getStatusText = () => req('/messages/status-text');
export const setStatusText = (text) => req('/messages/status-text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
});

export const searchMessages = (q, conversationId) => {
  const params = new URLSearchParams({ q });
  if (conversationId) params.set('conversationId', conversationId);
  return req(`/messages/search?${params.toString()}`);
};

export function streamUrl() {
  return `${BASE}/messages/stream?token=${encodeURIComponent(getToken())}`;
}

export function sendMessage(convId, { content, file, replyToId }) {
  const form = new FormData();
  if (content) form.append('content', content);
  if (file)    form.append('file', file);
  if (replyToId) form.append('replyToId', replyToId);
  return req(`/messages/conversations/${convId}/messages`, { method: 'POST', body: form });
}

export function fileUrl(path) {
  return `${BASE}${path}`;
}
