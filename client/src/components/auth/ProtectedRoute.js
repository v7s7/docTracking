import React from 'react';
import { useAuth } from '../../context/AuthContext';

const ROLE_WEIGHT = { READONLY: 1, STAFF: 2, MANAGER: 3, ADMIN: 4 };

/**
 * Wraps any route subtree.
 * - Shows a loading state while auth is resolving.
 * - Renders nothing (letting App redirect to <LoginPage>) when unauthenticated.
 * - Returns a 403 message when the user's role is below requiredRole.
 *
 * Usage:
 *   <ProtectedRoute requiredRole="MANAGER">
 *     <ApprovalDashboard />
 *   </ProtectedRoute>
 */
export default function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>;
  }

  if (!user) {
    // App.js renders <LoginPage> when user is null; this component renders nothing
    return null;
  }

  if (requiredRole) {
    const userWeight     = ROLE_WEIGHT[user.role]     || 0;
    const requiredWeight = ROLE_WEIGHT[requiredRole]  || 99;
    if (userWeight < requiredWeight) {
      return (
        <div style={styles.denied}>
          <strong>Access Denied.</strong> This page requires the <code>{requiredRole}</code> role.
        </div>
      );
    }
  }

  return children;
}

const styles = {
  denied: {
    padding: '2rem', color: '#c0392b', background: '#fdf0f0',
    borderRadius: '6px', margin: '2rem', border: '1px solid #f5c6cb',
  },
};
