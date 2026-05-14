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

// Departments
export const getDepartments   = ()          => request('GET',    '/admin/departments');
export const createDept       = (body)      => request('POST',   '/admin/departments', body);
export const updateDept       = (id, body)  => request('PUT',    `/admin/departments/${id}`, body);
export const deleteDept       = (id)        => request('DELETE', `/admin/departments/${id}`);

// Services (within a department)
export const getServices      = (deptId)              => request('GET',    `/admin/departments/${deptId}/services`);
export const createService    = (deptId, body)        => request('POST',   `/admin/departments/${deptId}/services`, body);
export const updateService    = (deptId, svcId, body) => request('PUT',    `/admin/departments/${deptId}/services/${svcId}`, body);
export const deleteService    = (deptId, svcId)       => request('DELETE', `/admin/departments/${deptId}/services/${svcId}`);

// Fields (within a service)
export const addField         = (deptId, svcId, body)        => request('POST',   `/admin/departments/${deptId}/services/${svcId}/fields`, body);
export const updateField      = (deptId, svcId, key, body)   => request('PUT',    `/admin/departments/${deptId}/services/${svcId}/fields/${key}`, body);
export const deleteField      = (deptId, svcId, key)         => request('DELETE', `/admin/departments/${deptId}/services/${svcId}/fields/${key}`);

// Role group map
export const getRoleMap       = ()          => request('GET',    '/admin/role-map');
export const setRoleMapEntry  = (body)      => request('PUT',    '/admin/role-map', body);
export const deleteRoleEntry  = (group)     => request('DELETE', `/admin/role-map/${encodeURIComponent(group)}`);

// Full config backup/restore
export const getConfig        = ()          => request('GET',    '/admin/config');
export const replaceConfig    = (config)    => request('PUT',    '/admin/config', { config });
