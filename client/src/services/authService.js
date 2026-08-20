const BASE_URL  = process.env.REACT_APP_API_URL || '';
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

export function persistUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

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

/**
 * Store a token the server handed back mid-session.
 *
 * Sessions slide: any request made past the halfway point of a token's life
 * comes back with a fresh one in the X-Renewed-Token header, so someone using
 * the system daily is never bounced to the login screen. See the sliding-session
 * block in server/middleware/authMiddleware.js.
 */
export function absorbRenewedToken(res) {
  try {
    const fresh = res?.headers?.get?.('X-Renewed-Token');
    if (fresh) localStorage.setItem(TOKEN_KEY, fresh);
  } catch (_) { /* never let this break a real response */ }
}

/**
 * Watch every response for a renewed token, once, globally.
 *
 * Patching window.fetch rather than each service's own req() helper: there are
 * six of those, each hand-written, and threading renewal through all of them
 * would guarantee one gets missed — the request that then carries the stale
 * token is the one that logs the user out.
 */
let installed = false;
export function installTokenRenewal() {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await original(...args);
    absorbRenewedToken(res);
    return res;
  };
}
