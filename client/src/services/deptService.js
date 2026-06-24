import { getToken } from './authService';

const BASE_URL = process.env.REACT_APP_API_URL || '';

export async function getDepartments() {
  const res  = await fetch(`${BASE_URL}/departments`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to load departments');
  return data.departments;
}
