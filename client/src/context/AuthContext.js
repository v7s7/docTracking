import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, fetchMe, getStoredUser } from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Initialise synchronously from localStorage to avoid a flash of the login page
  const [user, setUser]       = useState(getStoredUser);
  const [loading, setLoading] = useState(true);

  // Re-validate the stored token against the server on mount
  useEffect(() => {
    fetchMe()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
