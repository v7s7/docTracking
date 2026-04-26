import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function LoginPage() {
  const { login }                 = useAuth();
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      // AuthProvider sets user → App re-renders to the authenticated view
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>&#127963;</span>
        </div>
        <h2 style={styles.heading}>Document Tracking System</h2>
        <p style={styles.sub}>Sign in with your corporate credentials</p>

        {error && <div role="alert" style={styles.errorBox}>{error}</div>}

        <label style={styles.label}>
          Username
          <input
            style={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username or user@domain.com"
            autoComplete="username"
            required
            disabled={submitting}
          />
        </label>

        <label style={styles.label}>
          Password
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
          />
        </label>

        <button style={styles.btn} type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: '#eef1f7',
  },
  card: {
    background: '#fff', padding: '2.5rem 2rem', borderRadius: '10px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.10)', width: '100%', maxWidth: '380px',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  logoRow:   { textAlign: 'center' },
  logoIcon:  { fontSize: '2.5rem' },
  heading:   { margin: 0, fontSize: '1.35rem', color: '#1a1a2e', textAlign: 'center' },
  sub:       { margin: 0, color: '#777', fontSize: '0.875rem', textAlign: 'center' },
  errorBox:  {
    background: '#fdf0f0', color: '#c0392b', padding: '0.65rem 0.9rem',
    borderRadius: '5px', fontSize: '0.875rem', border: '1px solid #f5c6cb',
  },
  label: {
    display: 'flex', flexDirection: 'column', gap: '0.35rem',
    fontSize: '0.875rem', fontWeight: 600, color: '#333',
  },
  input: {
    padding: '0.55rem 0.75rem', border: '1px solid #ccc', borderRadius: '5px',
    fontSize: '0.95rem', fontWeight: 400, outline: 'none',
  },
  btn: {
    marginTop: '0.5rem', padding: '0.7rem', background: '#1a56db', color: '#fff',
    border: 'none', borderRadius: '5px', fontSize: '1rem', fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.02em',
  },
};
