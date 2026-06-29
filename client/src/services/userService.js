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

export const getUsers       = ()         => req('/users');
export const getLdapUsers   = ()         => req('/users/ldap');
export const createUser     = (body)     => req('/users', { method: 'POST', body: JSON.stringify(body) });
export const updateUser     = (id, body) => req(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteUser     = (id)       => req(`/users/${id}`, { method: 'DELETE' });
export const assignLdapRole = (body)     => req('/users/ldap-assign', { method: 'POST', body: JSON.stringify(body) });

export async function uploadAvatar(file) {
  const form = new FormData();
  form.append('avatar', file);
  const res  = await fetch(`${BASE}/users/me/avatar`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body:    form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');
  return data;
}

export const setAvatarColor = (color) => req('/users/me/avatar-color', { method: 'PUT', body: JSON.stringify({ color }) });
export const removeAvatar   = ()      => req('/users/me/avatar', { method: 'DELETE' });
