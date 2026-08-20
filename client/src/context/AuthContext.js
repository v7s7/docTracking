import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, fetchMe, getStoredUser, persistUser, installTokenRenewal } from '../services/authService';
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

  useEffect(() => {
    fetchMe()
      .then(fresh => { if (fresh) { persistUser(fresh); setUser(fresh); } else setUser(null); })
      .finally(() => setLoading(false));
  }, []);

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
