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

/**
 * Three outcomes, not two:
 *
 *   the user object  — the token is good; here is who the server says you are.
 *   null              — the token is genuinely no longer valid (401: expired,
 *                       revoked, the account was disabled or deleted). Sign out.
 *   undefined         — could not tell. The server is unreachable, or answered
 *                       with something other than a considered 401 (a 500, a
 *                       proxy timeout). Change nothing and let the caller keep
 *                       what it already has.
 *
 * The distinction used to not exist: ANY non-2xx response cleared the stored
 * token and logged the person out — including a five-second network blip on a
 * flaky connection. That was tolerable when this only ran once at page load.
 * It stopped being tolerable the moment something started calling it again
 * later (see installFocusRefresh below) — a call the person never asked for
 * must not be able to sign them out on a hiccup.
 */
export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
    if (!res.ok) return undefined;
    return (await res.json()).user;
  } catch {
    return undefined;
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

/**
 * Re-checks /auth/me whenever the tab comes back to the front, and hands the
 * (possibly unchanged) result to `onResult`.
 *
 * `user` in AuthContext is otherwise fetched exactly once, at page load, and
 * then lives in memory for as long as the tab stays open. Role, name and —
 * concretely — department are all read from that one snapshot in several
 * places (CreateTaskModal picks which service catalogue to show by matching
 * user.dept_id against the department list, for one). An administrator moving
 * someone to a different department writes it to the database immediately,
 * but a tab that was already open keeps showing the department it had at
 * load time until something makes it ask again — nothing ever did. The
 * person filing the request sees their OLD department's forms, not the one
 * they were just moved into.
 *
 * Tied to visibility rather than a timer: a tab nobody is looking at does not
 * need to be correct right now, and polling every open tab in the building
 * around the clock to close a staleness window that only matters when someone
 * is actually about to use the screen is the wrong trade. `minIntervalMs`
 * keeps a burst of alt-tabbing from firing a request every time.
 *
 * Every outcome of fetchMe() is honoured, INCLUDING undefined ("could not
 * tell") — which does nothing, which is the point: this must never be able to
 * sign someone out just because they switched tabs while the network hiccuped.
 */
export function installFocusRefresh(onResult, minIntervalMs = 60_000) {
  if (typeof document === 'undefined') return () => {};
  let last = Date.now();
  const handler = () => {
    if (document.hidden) return;
    if (Date.now() - last < minIntervalMs) return;
    last = Date.now();
    fetchMe().then(onResult);
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
