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
