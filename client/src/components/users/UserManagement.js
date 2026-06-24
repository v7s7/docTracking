import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import {
  getUsers, getLdapUsers, createUser, updateUser, deleteUser, assignLdapRole,
} from '../../services/userService';
import { getDepartments } from '../../services/deptService';
import {
  X, AlertTriangle, Users, Network, UserPlus, Search,
  RefreshCw, CheckCircle, XCircle, Edit2, Trash2, ShieldCheck,
} from 'lucide-react';

// Dropdown order: most-common role first so STAFF is visible at the top
const VALID_ROLES = ['STAFF', 'CUSTOMER_SERVICE', 'MANAGER', 'ADMIN', 'SUPER_ADMIN', 'READONLY'];

const ROLE_COLORS = {
  SUPER_ADMIN:      '#7B1414',
  ADMIN:            '#C41E1E',
  CUSTOMER_SERVICE: '#2D6E2D',
  MANAGER:          '#245724',
  STAFF:            '#B7791F',
  READONLY:         '#718096',
};

function RoleBadge({ role, t }) {
  return (
    <span className="badge" style={{ background: ROLE_COLORS[role] || '#888', color: '#fff', fontSize: '0.72rem' }}>
      {t.roles?.[role] || role}
    </span>
  );
}

function ActiveDot({ active, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, fontSize: '0.8rem', color: active ? 'var(--success)' : 'var(--text-3)' }}>
      {active ? <CheckCircle size={13} strokeWidth={2.2} /> : <XCircle size={13} strokeWidth={2.2} />}
      {active ? t.active : t.inactive}
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', minWidth: 200 }}>
      <Search size={13} strokeWidth={2} style={{ position: 'absolute', top: '50%', insetInlineStart: '0.55rem', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
      <input
        className="form-control"
        style={{ paddingInlineStart: '1.9rem', fontSize: '0.83rem', padding: '0.38rem 0.7rem', paddingInlineStart: '1.9rem' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function deptOptions(depts, t) {
  return Object.entries(
    depts.reduce((acc, d) => {
      const key = d.ldapGroup || d.id;
      acc[key] = acc[key] || (t.groupLabels?.[d.ldapGroup] || d.ldapGroup || d.id);
      return acc;
    }, {})
  );
}

// Roles that use dept-specific task forms and need a dept assigned
const DEPT_ROLES = ['STAFF', 'MANAGER', 'READONLY'];

// ── Role assignment modal (for LDAP users) ───────────────────
function LdapRoleModal({ user, depts, t, onSave, onClose }) {
  const [role,    setRole]    = useState(user.assigned_role || 'STAFF');
  const [dept_id, setDeptId]  = useState(user.assigned_dept || '');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await onSave({ username: user.username, full_name: user.name, email: user.email, role, dept_id });
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={16} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            {t.ldapAssignTitle}
          </h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {err && (
              <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
              </div>
            )}
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.2rem', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600 }}>{user.name}</div>
              <div className="text-sm text-muted" style={{ direction: 'ltr' }}>{user.username}{user.email ? ` · ${user.email}` : ''}</div>
              {user.department && <div className="text-sm text-muted">{user.department}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">{t.role} <span className="req">*</span></label>
              <select className="form-control" value={role} onChange={e => setRole(e.target.value)} required>
                {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                {t.deptAssign}
                {DEPT_ROLES.includes(role) && <span className="req"> *</span>}
              </label>
              <select className="form-control" value={dept_id} onChange={e => setDeptId(e.target.value)}
                required={DEPT_ROLES.includes(role)}>
                <option value="">—</option>
                {deptOptions(depts, t).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.3rem' }}>
                {DEPT_ROLES.includes(role) ? t.deptHint : t.deptOptionalHint}
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <ShieldCheck size={13} strokeWidth={2} />{t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Local user create/edit modal ─────────────────────────────
const blankForm = { username: '', password: '', full_name: '', email: '', role: 'STAFF', dept_id: '', is_active: true };

function UserModal({ initial, depts, t, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { ...initial, password: '', dept_id: initial.dept_id || '' }
    : blankForm);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const set    = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isEdit = !!initial;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;
      await onSave(payload);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">{isEdit ? t.editUser : t.addUser}</h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {err && (
              <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
              </div>
            )}
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">{t.username} <span className="req">*</span></label>
                <input className="form-control" value={form.username}
                  onChange={e => set('username', e.target.value)}
                  required disabled={isEdit} dir="ltr" />
              </div>
              <div className="form-group">
                <label className="form-label">{isEdit ? t.newPassword : `${t.password} *`}</label>
                <input className="form-control" type="password" value={form.password}
                  onChange={e => set('password', e.target.value)}
                  required={!isEdit} dir="ltr" />
              </div>
              <div className="form-group">
                <label className="form-label">{t.fullName} <span className="req">*</span></label>
                <input className="form-control" value={form.full_name}
                  onChange={e => set('full_name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t.email}</label>
                <input className="form-control" type="email" value={form.email}
                  onChange={e => set('email', e.target.value)} dir="ltr" />
              </div>
              <div className="form-group">
                <label className="form-label">{t.role} <span className="req">*</span></label>
                <select className="form-control" value={form.role}
                  onChange={e => set('role', e.target.value)} required>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  {t.deptAssign}
                  {DEPT_ROLES.includes(form.role) && <span className="req"> *</span>}
                </label>
                <select className="form-control" value={form.dept_id}
                  onChange={e => set('dept_id', e.target.value)} required={DEPT_ROLES.includes(form.role)}>
                  <option value="">—</option>
                  {deptOptions(depts, t).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.3rem' }}>
                  {DEPT_ROLES.includes(form.role) ? t.deptHint : t.deptOptionalHint}
                </div>
              </div>
              {isEdit && (
                <div className="form-group">
                  <label className="form-label">{t.active}</label>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={form.is_active}
                      onChange={e => set('is_active', e.target.checked)} />
                    <label className="checkbox-label">
                      {form.is_active ? t.active : t.inactive}
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t.save}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── LDAP network users table ─────────────────────────────────
function LdapUsersSection({ t, onAssigned }) {
  const [ldapUsers,  setLdapUsers]  = useState([]);
  const [dbRecords,  setDbRecords]  = useState({});   // keyed by username
  const [depts,      setDepts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [search,     setSearch]     = useState('');
  const [modal,      setModal]      = useState(null); // ldap user object
  const [msg,        setMsg]        = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ldapRes, usersRes, deptsRes] = await Promise.all([
        getLdapUsers(),
        getUsers(),
        getDepartments(),
      ]);
      setLdapUsers(ldapRes.users || []);
      // Build a map of username → DB record for LDAP-linked users
      const map = {};
      (usersRes.users || []).filter(u => u.is_ldap).forEach(u => { map[u.username] = u; });
      setDbRecords(map);
      setDepts(deptsRes);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3000); }

  async function handleAssign(payload) {
    const { user } = await assignLdapRole(payload);
    setDbRecords(prev => ({ ...prev, [user.username]: user }));
    flash(t.roleAssigned);
    onAssigned?.();
  }

  const filtered = ldapUsers.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.name || '').toLowerCase().includes(q)
        || (u.username || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q)
        || (u.department || '').toLowerCase().includes(q)
        || (u.title || '').toLowerCase().includes(q);
  });

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Network size={18} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
          <div>
            <div className="card-title">{t.ldapUsers}</div>
            <div className="card-subtitle">
              {loading ? '…' : `${ldapUsers.length} ${(t.users || 'users').toLowerCase()}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <SearchBox value={search} onChange={setSearch} placeholder={t.search} />
          <button className="btn btn-ghost btn-sm" onClick={load} title={t.refresh}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <RefreshCw size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {msg && (
        <div className="alert alert-success"
          style={{ margin: '0 1.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={14} strokeWidth={2} />{msg}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ margin: '0 1.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={14} strokeWidth={2} />
          <span>
            {error.includes('NOT_CONFIGURED') || error.includes('not configured')
              ? t.ldapNotConfigured
              : error}
          </span>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        {loading ? (
          <div className="page-loading" style={{ height: 180 }}>
            <span className="spinner" /><span>{t.loading}</span>
          </div>
        ) : !filtered.length ? (
          <div className="empty-state" style={{ padding: '2.5rem' }}>
            <div className="empty-icon"><Network size={28} strokeWidth={1.4} /></div>
            <div className="empty-sub">
              {search ? t.noResults : t.noLdapUsers}
            </div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t.fullName}</th>
                <th>{t.username}</th>
                <th>{t.email}</th>
                <th>{t.dept}</th>
                <th>{t.ldapTitle}</th>
                <th>{t.role}</th>
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const db = dbRecords[u.username];
                return (
                  <tr key={u.username || i}>
                    <td style={{ fontWeight: 500 }}>{u.name || '—'}</td>
                    <td><code className="tag" style={{ fontSize: '0.78em' }}>{u.username}</code></td>
                    <td className="text-sm text-muted">{u.email || '—'}</td>
                    <td className="text-sm text-muted">
                      {db?.dept_id ? (t.groupLabels?.[db.dept_id] || db.dept_id) : (u.department || '—')}
                    </td>
                    <td className="text-sm text-muted">{u.title || '—'}</td>
                    <td>
                      {db
                        ? <RoleBadge role={db.role} t={t} />
                        : <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{t.unassigned}</span>
                      }
                    </td>
                    <td>
                      <button
                        className={`btn btn-sm ${db ? 'btn-ghost' : 'btn-primary'}`}
                        onClick={() => setModal({ ...u, assigned_role: db?.role, assigned_dept: db?.dept_id })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                        <ShieldCheck size={12} strokeWidth={2} />
                        {db ? t.editRole : t.assignRole}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <LdapRoleModal
          user={modal}
          depts={depts}
          t={t}
          onSave={handleAssign}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Local users table ────────────────────────────────────────
function LocalUsersSection({ t, onChanged }) {
  const [users,   setUsers]   = useState([]);
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [msg,     setMsg]     = useState('');
  const [search,  setSearch]  = useState('');

  const load = useCallback(async () => {
    try {
      const [ud, dd] = await Promise.all([getUsers(), getDepartments()]);
      setUsers(ud.users.filter(u => !u.is_ldap));  // only password-based accounts
      setDepts(dd);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3000); }

  async function handleSave(form) {
    if (modal === 'create') {
      const { user } = await createUser(form);
      setUsers(p => [user, ...p]);
      flash(t.userCreated);
    } else {
      const { user } = await updateUser(modal.id, form);
      setUsers(p => p.map(u => u.id === user.id ? user : u));
      flash(t.userUpdated);
    }
    onChanged?.();
  }

  async function handleDelete(u) {
    if (!window.confirm(t.confirmDel)) return;
    try {
      await deleteUser(u.id);
      setUsers(p => p.filter(x => x.id !== u.id));
      flash(t.userDeleted);
      onChanged?.();
    } catch (e) { flash(`ERR:${e.message}`); }
  }

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.full_name || '').toLowerCase().includes(q)
        || (u.username  || '').toLowerCase().includes(q)
        || (u.email     || '').toLowerCase().includes(q);
  });

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <UserPlus size={18} strokeWidth={1.7} style={{ color: 'var(--primary)' }} />
          <div>
            <div className="card-title">{t.localUsers}</div>
            <div className="card-subtitle">
              {users.length} {(t.users || 'users').toLowerCase()}
              {' — '}{t.localUsersNote}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <SearchBox value={search} onChange={setSearch} placeholder={t.search} />
          <button className="btn btn-primary btn-sm" onClick={() => setModal('create')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
            <UserPlus size={14} strokeWidth={2} />{t.addUser}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.startsWith('ERR:') ? 'alert-error' : 'alert-success'}`}
          style={{ margin: '0 1.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {msg.startsWith('ERR:') && <AlertTriangle size={14} strokeWidth={2} />}
          {msg.replace('ERR:', '')}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        {loading ? (
          <div className="page-loading" style={{ height: 180 }}><span className="spinner" /></div>
        ) : !filtered.length ? (
          <div className="empty-state" style={{ padding: '2.5rem' }}>
            <div className="empty-icon"><Users size={28} strokeWidth={1.4} /></div>
            <div className="empty-sub">{search ? t.noResults : t.noUsers}</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t.fullName}</th>
                <th>{t.username}</th>
                <th>{t.role}</th>
                <th>{t.deptAssign}</th>
                <th>{t.active}</th>
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.full_name}</div>
                    {u.email && <div className="text-sm text-muted">{u.email}</div>}
                  </td>
                  <td><code className="tag" style={{ fontSize: '0.78em' }}>{u.username}</code></td>
                  <td><RoleBadge role={u.role} t={t} /></td>
                  <td className="text-sm text-muted">
                    {u.dept_id ? (t.groupLabels?.[u.dept_id] || u.dept_id) : '—'}
                  </td>
                  <td><ActiveDot active={u.is_active} t={t} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setModal(u)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Edit2 size={12} strokeWidth={2} />{t.edit}
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Trash2 size={12} strokeWidth={2} />{t.del}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <UserModal
          initial={modal === 'create' ? null : modal}
          depts={depts}
          t={t}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Roles reference guide ────────────────────────────────────
const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

function RolesGuide({ t, dbUsers }) {
  const counts = ROLE_ORDER.reduce((acc, r) => {
    acc[r] = dbUsers.filter(u => u.role === r).length;
    return acc;
  }, {});

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <ShieldCheck size={18} strokeWidth={1.7} style={{ color: 'var(--primary)' }} />
          <div>
            <div className="card-title">{t.rolesGuide}</div>
            <div className="card-subtitle">{t.rolesGuideNote}</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem', padding: '0 1.5rem 1.5rem' }}>
        {ROLE_ORDER.map(role => (
          <div key={role} style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '0.85rem 1rem',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <RoleBadge role={role} t={t} />
              {counts[role] > 0 && (
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', background: 'var(--border)', borderRadius: 20, padding: '0.1rem 0.55rem' }}>
                  {counts[role]} {t.assigned}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
              {t.roleDesc?.[role]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────
export default function UserManagement() {
  const { t } = useLang();
  const [dbUsers, setDbUsers] = useState([]);

  // Shared fetch so RolesGuide counts stay in sync with both tables
  useEffect(() => {
    getUsers().then(r => setDbUsers(r.users || [])).catch(() => {});
  }, []);

  function refreshDbUsers() {
    getUsers().then(r => setDbUsers(r.users || [])).catch(() => {});
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <RolesGuide t={t} dbUsers={dbUsers} />
      <LdapUsersSection t={t} onAssigned={refreshDbUsers} />
      <LocalUsersSection t={t} onChanged={refreshDbUsers} />
    </div>
  );
}
