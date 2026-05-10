import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getUsers, getLdapUsers, createUser, updateUser, deleteUser } from '../../services/userService';
import { getDepartments } from '../../services/deptService';
import {
  X, AlertTriangle, Users, Network, UserPlus, Search,
  RefreshCw, CheckCircle, XCircle, Edit2, Trash2,
} from 'lucide-react';

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

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
      {active
        ? <CheckCircle size={13} strokeWidth={2.2} />
        : <XCircle    size={13} strokeWidth={2.2} />
      }
      {active ? t.active : t.inactive}
    </span>
  );
}

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

  const deptOptions = Object.entries(
    depts.reduce((acc, d) => {
      const key = d.ldapGroup || d.id;
      acc[key] = acc[key] || (t.groupLabels?.[d.ldapGroup] || d.ldapGroup || d.id);
      return acc;
    }, {})
  );

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
                <label className="form-label">{t.deptAssign}</label>
                <select className="form-control" value={form.dept_id}
                  onChange={e => set('dept_id', e.target.value)}>
                  <option value="">—</option>
                  {deptOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
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

// ── Searchable column header ─────────────────────────────────
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

// ── LDAP network users table ─────────────────────────────────
function LdapUsersSection({ t }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await getLdapUsers();
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => {
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
              {loading ? '…' : `${users.length} ${(t.users || 'users').toLowerCase()}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <SearchBox value={search} onChange={setSearch} placeholder={t.search} />
          <button className="btn btn-ghost btn-sm" onClick={load} title={t.refresh} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <RefreshCw size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ margin: '0 1.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={14} strokeWidth={2} />
          <span>
            {error.includes('NOT_CONFIGURED') || error.includes('not configured')
              ? t.ldapNotConfigured
              : error
            }
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.username || i}>
                  <td style={{ fontWeight: 500 }}>{u.name || '—'}</td>
                  <td><code className="tag" style={{ fontSize: '0.78em' }}>{u.username}</code></td>
                  <td className="text-sm text-muted">{u.email || '—'}</td>
                  <td className="text-sm text-muted">{u.department || '—'}</td>
                  <td className="text-sm text-muted">{u.title || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Local users table ────────────────────────────────────────
function LocalUsersSection({ t }) {
  const [users,   setUsers]   = useState([]);
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);
  const [msg,     setMsg]     = useState('');
  const [search,  setSearch]  = useState('');

  const load = useCallback(async () => {
    try {
      const [ud, dd] = await Promise.all([getUsers(), getDepartments()]);
      setUsers(ud.users);
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
  }

  async function handleDelete(u) {
    if (!window.confirm(t.confirmDel)) return;
    try {
      await deleteUser(u.id);
      setUsers(p => p.filter(x => x.id !== u.id));
      flash(t.userDeleted);
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
            <div className="empty-sub">
              {search ? t.noResults : t.noUsers}
            </div>
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

// ── Page ─────────────────────────────────────────────────────
export default function UserManagement() {
  const { t } = useLang();
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <LdapUsersSection t={t} />
      <LocalUsersSection t={t} />
    </div>
  );
}
