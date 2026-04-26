import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './components/auth/LoginPage';

function AppRoutes() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div style={{ padding: '2rem' }}>
      <header style={styles.header}>
        <h1 style={styles.title}>Document Tracking System</h1>
        <div style={styles.userBar}>
          <span style={styles.userInfo}>
            {user.name} &mdash; <strong>{user.role}</strong>
          </span>
          <button onClick={logout} style={styles.signOutBtn}>Sign Out</button>
        </div>
      </header>
      <main>
        {/* Workflow and document components mount here */}
        <p style={{ color: '#555' }}>Welcome, {user.name}. Department: {user.department || 'N/A'}</p>
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

const styles = {
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #e0e0e0',
  },
  title:   { margin: 0, fontSize: '1.4rem', color: '#1a1a2e' },
  userBar: { display: 'flex', alignItems: 'center', gap: '1rem' },
  userInfo:{ fontSize: '0.9rem', color: '#555' },
  signOutBtn: {
    padding: '0.35rem 1rem', borderRadius: '4px', border: '1px solid #ccc',
    background: '#fff', cursor: 'pointer', fontSize: '0.9rem',
  },
};
