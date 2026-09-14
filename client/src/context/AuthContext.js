import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  login as apiLogin, logout as apiLogout, fetchMe, getStoredUser, persistUser,
  installTokenRenewal, installFocusRefresh,
} from '../services/authService';
import { sendPresence } from '../services/messageService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Initialise synchronously from localStorage to avoid a flash of the login page
  const [user, setUser]       = useState(getStoredUser);
  const [loading, setLoading] = useState(true);

  // Re-validate the stored token against the server on mount. /auth/me returns
  // the identity as the server currently sees it — role and department are
  // re-read from the users table on every request — so this is also how a role
  // or department change reaches the sidebar. Persisting it means the next load
  // starts from the corrected value rather than briefly showing the old one.
  // Installed before the first request so no renewal is missed.
  installTokenRenewal();

  // Three outcomes from fetchMe(), and they mean three different things for
  // what happens to the screen someone is looking at:
  //   an object   → the server's current answer. Adopt it.
  //   null        → the token is genuinely no longer valid. Sign out.
  //   undefined   → could not tell (network hiccup, 500). Change NOTHING —
  //                 in particular, do not sign out over it. This matters far
  //                 more once this same handler is also driving the focus
  //                 refresh below than it did when it only ran once at load.
  const applyFetchedUser = useCallback((fresh) => {
    if (fresh === undefined) return;
    if (fresh) { persistUser(fresh); setUser(fresh); }
    else setUser(null);
  }, []);

  useEffect(() => {
    fetchMe().then(applyFetchedUser).finally(() => setLoading(false));
  }, [applyFetchedUser]);

  // Re-asks the server whenever the tab regains focus. Without this, `user`
  // is whatever it was at the moment this tab was opened for the rest of the
  // session — an administrator moving someone to a different department, or
  // changing their role, writes to the database immediately but has no way to
  // reach a tab that is already open. See installFocusRefresh's own comment
  // for the concrete symptom this closes (CreateTaskModal picking the wrong
  // department's forms).
  useEffect(() => installFocusRefresh(applyFetchedUser), [applyFetchedUser]);

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password);
    setUser(data.user);
    return data;
  }, []);

  // Merge partial fields (e.g. a fresh avatar_url) into both state and storage
  // right after a self-service update, so the UI reflects it without a reload.
  const updateUser = useCallback((patch) => {
    setUser(prev => {
      const next = { ...prev, ...patch };
      persistUser(next);
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    // Mark the user offline immediately so colleagues don't see a stale
    // "Online" / "Last seen" for up to the usual presence window.
    await sendPresence('offline').catch(() => {});
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
