const BASE_URL  = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const TOKEN_KEY = 'doctracking_token';
const USER_KEY  = 'doctracking_user';

export async function login(username, password) {
  const res  = await fetch(`${BASE_URL}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.message || 'Login failed.');
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY,  JSON.stringify(data.user));
  return data;
}

export async function logout() {
  const token = getToken();
  if (token) {
    // Best-effort server-side logout log; ignore network errors
    try {
      await fetch(`${BASE_URL}/auth/logout`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_) {}
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try   { return JSON.parse(localStorage.getItem(USER_KEY)); }
  catch { return null; }
}

// Validates the locally stored token against the server.
// Returns the user object on success, or null if the token is invalid/expired.
export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
    return (await res.json()).user;
  } catch {
    return null;
  }
}
