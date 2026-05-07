import { getToken } from './authService';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5050';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: authHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Request failed');
  return data;
}

export const getDepartments   = ()          => request('GET',    '/admin/departments');
export const createDept       = (body)      => request('POST',   '/admin/departments', body);
export const updateDept       = (id, body)  => request('PUT',    `/admin/departments/${id}`, body);
export const deleteDept       = (id)        => request('DELETE', `/admin/departments/${id}`);

export const addField         = (id, body)  => request('POST',   `/admin/departments/${id}/fields`, body);
export const updateField      = (id, k, b)  => request('PUT',    `/admin/departments/${id}/fields/${k}`, b);
export const deleteField      = (id, k)     => request('DELETE', `/admin/departments/${id}/fields/${k}`);

export const getRoleMap       = ()          => request('GET',    '/admin/role-map');
export const setRoleMapEntry  = (body)      => request('PUT',    '/admin/role-map', body);
export const deleteRoleEntry  = (group)     => request('DELETE', `/admin/role-map/${encodeURIComponent(group)}`);

export const getConfig        = ()          => request('GET',    '/admin/config');
export const replaceConfig    = (config)    => request('PUT',    '/admin/config', { config });
