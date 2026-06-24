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

export const getTemplates    = ()         => req('/templates');
export const createTemplate  = (body)     => req('/templates', { method: 'POST', body: JSON.stringify(body) });
export const updateTemplate  = (id, body) => req(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteTemplate  = (id)       => req(`/templates/${id}`, { method: 'DELETE' });
