import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LangProvider, useLang } from './context/LangContext';
import LoginPage from './components/auth/LoginPage';
import SuperAdminPanel from './components/admin/SuperAdminPanel';
import { getDepartments } from './services/deptService';

// ── Group departments by ldapGroup ───────────────────────────
function groupDepts(depts) {
  const groups = {};
  for (const d of depts) {
    const g = d.ldapGroup || '__other__';
    if (!groups[g]) groups[g] = [];
    groups[g].push(d);
  }
  return groups;
}

// ── Render a single form field ───────────────────────────────
function FormField({ field, value, onChange }) {
  const { t } = useLang();
  const id = `field-${field.key}`;

  if (field.type === 'checkbox') {
    return (
      <div className="form-group">
        <div className="checkbox-row">
          <input
            id={id}
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(field.key, e.target.checked)}
          />
          <label className="checkbox-label" htmlFor={id}>
            {field.label}
            {field.required && <span className="req"> *</span>}
          </label>
        </div>
      </div>
    );
  }

  const isWide = field.type === 'textarea';

  return (
    <div className={`form-group${isWide ? ' full-width' : ''}`}>
      <label className="form-label" htmlFor={id}>
        {field.label}
        {field.required && <span className="req"> *</span>}
      </label>

      {field.type === 'select' ? (
        <select
          id={id}
          className="form-control"
          value={value || ''}
          onChange={e => onChange(field.key, e.target.value)}
          required={field.required}
        >
          <option value="">—</option>
          {(field.options || []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          className="form-control"
          value={value || ''}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder || ''}
          required={field.required}
          rows={3}
        />
      ) : (
        <input
          id={id}
          className="form-control"
          type={field.type}
          value={value || ''}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder || ''}
          required={field.required}
          dir={field.type === 'number' || field.type === 'date' || field.type === 'email' ? 'ltr' : undefined}
        />
      )}
    </div>
  );
}

// ── Department form view ─────────────────────────────────────
function DeptFormView({ dept }) {
  const { t } = useLang();
  const [values, setValues]   = useState({});
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setValues({});
    setSuccess(false);
  }, [dept.id]);

  function handleChange(key, val) {
    setValues(p => ({ ...p, [key]: val }));
    setSuccess(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Placeholder: no backend records endpoint yet — show success toast
    setSuccess(true);
    setTimeout(() => setSuccess(false), 4000);
  }

  function handleReset() {
    setValues({});
    setSuccess(false);
  }

  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <div className="card-header">
        <div>
          <div className="card-title">{dept.label}</div>
          <div className="card-subtitle">{t.newRecord}</div>
        </div>
      </div>

      <div className="card-body">
        {success && (
          <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>
            <span>✓</span>
            <span>{t.submitted}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {dept.fields.map(field => (
              <FormField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={handleChange}
              />
            ))}
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" type="submit">{t.submit}</button>
            <button className="btn btn-secondary" type="button" onClick={handleReset}>{t.reset}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────
function Sidebar({ depts, activeDeptId, onSelect, onAdminClick, showAdmin, user }) {
  const { t } = useLang();
  const groups = groupDepts(depts);

  return (
    <aside className="app-sidebar">
      {Object.entries(groups).map(([groupKey, items]) => (
        <div className="sidebar-section" key={groupKey}>
          <div className="sidebar-section-title">
            {t.groupLabels?.[groupKey] || groupKey}
          </div>
          {items.map(d => (
            <div
              key={d.id}
              className={`sidebar-item${activeDeptId === d.id ? ' active' : ''}`}
              onClick={() => onSelect(d.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelect(d.id)}
            >
              <span className="sidebar-dot" />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      ))}

      {user?.role === 'SUPER_ADMIN' && (
        <>
          <div className="sidebar-divider" style={{ margin: 'auto 1rem 0.5rem' }} />
          <div
            className={`sidebar-admin-item${showAdmin ? ' active' : ''}`}
            onClick={onAdminClick}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onAdminClick()}
          >
            <span>⚙</span>
            <span>{t.adminPanel}</span>
          </div>
        </>
      )}
    </aside>
  );
}

// ── Header ───────────────────────────────────────────────────
function Header({ user }) {
  const { logout } = useAuth();
  const { t, lang, toggle } = useLang();

  const initials = (user?.name || user?.username || '?')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('');

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">🕌</div>
        <div>
          <div className="header-title">{t.orgName}</div>
          <div className="header-subtitle">{t.appName}</div>
        </div>
      </div>

      <div className="header-actions">
        <div className="lang-toggle">
          <button
            className={`lang-btn${lang === 'ar' ? ' active' : ''}`}
            onClick={() => lang !== 'ar' && toggle()}
            type="button"
          >
            عربي
          </button>
          <button
            className={`lang-btn${lang === 'en' ? ' active' : ''}`}
            onClick={() => lang !== 'en' && toggle()}
            type="button"
          >
            EN
          </button>
        </div>

        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{user?.name || user?.username}</div>
            <div className="user-role-badge">{t.roles?.[user?.role] || user?.role}</div>
          </div>
        </div>

        <button className="btn-header" onClick={logout}>{t.signOut}</button>
      </div>
    </header>
  );
}

// ── Authenticated shell ──────────────────────────────────────
function AppShell() {
  const { user, loading }   = useAuth();
  const { t }               = useLang();
  const [depts, setDepts]   = useState([]);
  const [activeDeptId, setActiveDeptId] = useState(null);
  const [showAdmin, setShowAdmin]       = useState(false);
  const [deptsLoading, setDeptsLoading] = useState(true);

  const loadDepts = useCallback(async () => {
    try {
      const data = await getDepartments();
      setDepts(data);
      if (data.length > 0 && !activeDeptId) setActiveDeptId(data[0].id);
    } catch (_) {
      // departments unavailable — not fatal
    } finally {
      setDeptsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) loadDepts();
  }, [user, loadDepts]);

  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
        <span>{t.loading}</span>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const activeDept = depts.find(d => d.id === activeDeptId);

  return (
    <div className="app-shell" style={{ flexDirection: 'column' }}>
      <Header user={user} />

      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar
          depts={depts}
          activeDeptId={showAdmin ? null : activeDeptId}
          onSelect={id => { setActiveDeptId(id); setShowAdmin(false); }}
          onAdminClick={() => setShowAdmin(p => !p)}
          showAdmin={showAdmin}
          user={user}
        />

        <main className="app-main">
          {showAdmin ? (
            <SuperAdminPanel />
          ) : deptsLoading ? (
            <div className="page-loading">
              <span className="spinner" />
              <span>{t.loading}</span>
            </div>
          ) : activeDept ? (
            <DeptFormView key={activeDept.id} dept={activeDept} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <div className="empty-title">{t.selectDept}</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────
export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </LangProvider>
  );
}
