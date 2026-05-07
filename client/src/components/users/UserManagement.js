import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getUsers, createUser, updateUser, deleteUser } from '../../services/userService';
import { getDepartments } from '../../services/deptService';

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

const ROLE_COLORS = {
  SUPER_ADMIN:      '#6c3483',
  ADMIN:            '#1a56db',
  CUSTOMER_SERVICE: '#0D7C7E',
  MANAGER:          '#0e7c50',
  STAFF:            '#b7770d',
  READONLY:         '#718096',
};

function RoleBadge({ role, t }) {
  return (
    <span className="badge" style={{ background: ROLE_COLORS[role] || '#888', color: '#fff' }}>
      {t.roles?.[role] || role}
    </span>
  );
}

const blankForm = { username: '', password: '', full_name: '', email: '', role: 'STAFF', dept_id: '', is_active: true };

function UserModal({ initial, depts, t, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { ...initial, password: '', dept_id: initial.dept_id || '' }
    : blankForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
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
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}><span>⚠</span><span>{err}</span></div>}
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">{t.username} <span className="req">*</span></label>
                <input className="form-control" value={form.username} onChange={e => set('username', e.target.value)}
                  required disabled={isEdit} dir="ltr" />
              </div>

              <div className="form-group">
                <label className="form-label">{isEdit ? t.newPassword : `${t.password} *`}</label>
                <input className="form-control" type="password" value={form.password}
                  onChange={e => set('password', e.target.value)} required={!isEdit} dir="ltr" />
              </div>

              <div className="form-group">
                <label className="form-label">{t.fullName} <span className="req">*</span></label>
                <input className="form-control" value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">{t.email}</label>
                <input className="form-control" type="email" value={form.email} onChange={e => set('email', e.target.value)} dir="ltr" />
              </div>

              <div className="form-group">
                <label className="form-label">{t.role} <span className="req">*</span></label>
                <select className="form-control" value={form.role} onChange={e => set('role', e.target.value)} required>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">{t.deptAssign}</label>
                <select className="form-control" value={form.dept_id} onChange={e => set('dept_id', e.target.value)}>
                  <option value="">—</option>
                  {Object.entries(
                    depts.reduce((acc, d) => { acc[d.ldapGroup || d.id] = acc[d.ldapGroup || d.id] || (t.groupLabels?.[d.ldapGroup] || d.ldapGroup || d.id); return acc; }, {})
                  ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {isEdit && (
                <div className="form-group">
                  <label className="form-label">{t.active}</label>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                    <label className="checkbox-label">{form.is_active ? t.active : t.inactive}</label>
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

export default function UserManagement() {
  const { t }             = useLang();
  const [users, setUsers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]   = useState(null); // null | 'create' | user object
  const [msg, setMsg]       = useState('');

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
    } catch (e) { flash(`⚠ ${e.message}`); }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{t.users}</div>
            <div className="card-subtitle">{users.length} {t.users.toLowerCase()}</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setModal('create')}>{t.addUser}</button>
        </div>

        {msg && (
          <div className={`alert ${msg.startsWith('⚠') ? 'alert-error' : 'alert-success'}`} style={{ margin: '0 1.5rem 0.5rem' }}>
            {msg}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="page-loading" style={{ height: 200 }}><span className="spinner" /></div>
          ) : !users.length ? (
            <div className="empty-state"><div className="empty-icon">👥</div><div className="empty-sub">{t.noUsers}</div></div>
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
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.full_name}</div>
                      {u.email && <div className="text-sm text-muted">{u.email}</div>}
                    </td>
                    <td><code className="tag">{u.username}</code></td>
                    <td><RoleBadge role={u.role} t={t} /></td>
                    <td className="text-sm text-muted">
                      {u.dept_id ? (t.groupLabels?.[u.dept_id] || u.dept_id) : '—'}
                    </td>
                    <td>
                      <span style={{ color: u.is_active ? 'var(--success)' : 'var(--text-3)', fontWeight: 600, fontSize: '0.82rem' }}>
                        {u.is_active ? '● ' + t.active : '○ ' + t.inactive}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-ghost" style={{ marginInlineEnd: '0.3rem' }} onClick={() => setModal(u)}>{t.edit}</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u)}>{t.del}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
