import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './components/auth/LoginPage';
import SuperAdminPanel from './components/admin/SuperAdminPanel';

function AppRoutes() {
  const { user, loading, logout } = useAuth();
  const [showAdmin, setShowAdmin] = useState(false);

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>;
  if (!user)   return <LoginPage />;

  if (showAdmin && user.role === 'SUPER_ADMIN') {
    return <SuperAdminPanel onBack={() => setShowAdmin(false)} />;
  }

  return (
    <div style={{ padding: '2rem' }}>
      <header style={st.header}>
        <h1 style={st.title}>Document Tracking System</h1>
        <div style={st.bar}>
          {user.role === 'SUPER_ADMIN' && (
            <button style={st.adminBtn} onClick={() => setShowAdmin(true)}>⚙ Admin Panel</button>
          )}
          <span style={st.info}>{user.name} &mdash; <strong>{user.role}</strong></span>
          <button style={st.signOut} onClick={logout}>Sign Out</button>
        </div>
      </header>
      <main>
        <p style={{ color: '#555' }}>Welcome, {user.name}. Department: {user.department || 'N/A'}</p>
        {/* Workflow and document components will be mounted here */}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

const st = {
  header:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #e0e0e0' },
  title:    { margin: 0, fontSize: '1.4rem', color: '#1a1a2e' },
  bar:      { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  info:     { fontSize: '0.9rem', color: '#555' },
  adminBtn: { padding: '0.35rem 1rem', borderRadius: 4, border: '1px solid #6c3483', background: '#f5edfb', color: '#6c3483', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
  signOut:  { padding: '0.35rem 1rem', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.9rem' },
};
