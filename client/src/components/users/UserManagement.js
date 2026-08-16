import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLang } from '../../context/LangContext';
import {
  getUsers, getLdapUsers, createUser, updateUser, deleteUser, assignLdapRole,
  bulkUpdateUsers,
} from '../../services/userService';
import { getDepartments } from '../../services/deptService';
import { getAuditLog } from '../../services/auditService';
import {
  X, AlertTriangle, Users, Network, UserPlus, Search, ChevronDown,
  RefreshCw, CheckCircle, XCircle, Edit2, Trash2, ShieldCheck, Phone, History, Lock,
} from 'lucide-react';
import { useConfirm } from '../common/ConfirmDialog';
import DepartmentSelect from '../common/DepartmentSelect';

// SWD's model is four levels: مدير النظام (IT) · رئيس القسم · النائب · موظف.
// CUSTOMER_SERVICE and READONLY belong to the retired task feature — the backend
// still accepts them so existing holders keep working, but offering them here
// only invites mis-assignment.
const VALID_ROLES = ['STAFF', 'ADMIN', 'MANAGER', 'SUPER_ADMIN'];
const ROLE_ORDER  = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];

const ROLE_COLORS = {
  SUPER_ADMIN:      '#7B1414',
  ADMIN:            '#C41E1E',
  CUSTOMER_SERVICE: '#2D6E2D',
  MANAGER:          '#245724',
  STAFF:            '#B7791F',
  READONLY:         '#718096',
};

// Everyone except the IT super admin acts within one department.
const DEPT_ROLES = ['STAFF', 'MANAGER', 'ADMIN', 'READONLY'];

function RoleBadge({ role, t }) {
  return (
    <span className="badge" style={{ background: ROLE_COLORS[role] || '#888', color: '#fff', fontSize: 'var(--fs-xs)' }}>
      {t.roles?.[role] || role}
    </span>
  );
}

function ActiveDot({ active, t }) {
  return (
    <span className="usr-active" style={{ color: active ? 'var(--success)' : 'var(--text-3)' }}>
      {active ? <CheckCircle size={13} strokeWidth={2.2} /> : <XCircle size={13} strokeWidth={2.2} />}
      {active ? t.active : t.inactive}
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="corr-search">
      <Search size={15} strokeWidth={2} />
      <input className="form-control form-control-sm" value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button className="dir-clear" onClick={() => onChange('')} aria-label="clear">
          <X size={13} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

function deptOptions(depts, t) {
  const seen = new Set();
  const out  = [];
  for (const d of depts) {
    const key = d.ldapGroup || d.id;
    if (seen.has(key)) continue;
    seen.add(key);
    // groupLabels carries the English translations; departments.json is the
    // live source and covers anything added through the admin panel.
    out.push({ id: key, label: t.groupLabels?.[key] || d.label || key });
  }
  return out;
}

// ── Role assignment modal (for LDAP users not yet in the system) ─────────────
function LdapRoleModal({ user, depts, t, onSave, onClose }) {
  const [role,    setRole]   = useState(user.assigned_role || 'STAFF');
  const [dept_id, setDeptId] = useState(user.assigned_dept || '');
  const [busy,    setBusy]   = useState(false);
  const [err,     setErr]    = useState('');

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
            <div className="usr-peek">
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
                {t.deptAssign}{DEPT_ROLES.includes(role) && <span className="req"> *</span>}
              </label>
              <DepartmentSelect departments={deptOptions(depts, t)} value={dept_id}
                onChange={setDeptId} t={t} emptyLabel={t.noDept || '—'} />
              <div className="form-hint">{DEPT_ROLES.includes(role) ? t.deptHint : t.deptOptionalHint}</div>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              <ShieldCheck size={13} strokeWidth={2} />{t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create / edit one user ──────────────────────────────────────────────────
const blankForm = { username: '', password: '', full_name: '', email: '', role: 'STAFF', dept_id: '', is_active: true, ext: '', mobile: '', alt_email: '' };

function UserModal({ initial, depts, t, can = {}, onSave, onClose }) {
  const [form, setForm] = useState(initial ? { ...initial, password: '', dept_id: initial.dept_id || '' } : blankForm);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const set    = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isEdit = !!initial;
  // An AD account has no local password — offering a password field on one
  // implies it would be used at login, and it never is.
  const isLdap = isEdit && initial.is_ldap;
  const roles  = VALID_ROLES.filter(r => (can.assignableRoles || VALID_ROLES).includes(r));
  const canSetPassword = can.createUsers !== false;

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
                  onChange={e => set('username', e.target.value)} required disabled={isEdit} dir="ltr" />
              </div>
              {!isLdap && canSetPassword && (
                <div className="form-group">
                  <label className="form-label">{isEdit ? t.newPassword : `${t.password} *`}</label>
                  <input className="form-control" type="password" value={form.password}
                    onChange={e => set('password', e.target.value)} required={!isEdit} dir="ltr" />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t.fullName} <span className="req">*</span></label>
                <input className="form-control" value={form.full_name}
                  onChange={e => set('full_name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t.email}</label>
                <input className="form-control" type="email" value={form.email || ''}
                  onChange={e => set('email', e.target.value)} dir="ltr" />
              </div>
              {/* Extension and mobile feed دليل الهاتف, which people use daily —
                  so a desk move is fixed here rather than by editing a config
                  file and re-running the directory linker. */}
              <div className="form-group">
                <label className="form-label">{t.directory.altEmail}</label>
                <input className="form-control" type="email" value={form.alt_email || ''}
                  onChange={e => set('alt_email', e.target.value)} dir="ltr" placeholder="name@gmail.com" />
                <div className="form-hint">{t.usersAdmin.altEmailHint}</div>
              </div>
              <div className="form-group">
                <label className="form-label">{t.directory.ext}</label>
                <input className="form-control" value={form.ext || ''} inputMode="numeric"
                  onChange={e => set('ext', e.target.value)} dir="ltr" placeholder="5022" />
                <div className="form-hint">{t.usersAdmin.extHint}</div>
              </div>
              <div className="form-group">
                <label className="form-label">{t.directory.mobile}</label>
                <input className="form-control" value={form.mobile || ''} inputMode="tel"
                  onChange={e => set('mobile', e.target.value)} dir="ltr" placeholder="39224992" />
              </div>
              <div className="form-group">
                <label className="form-label">{t.role} <span className="req">*</span></label>
                <select className="form-control" value={form.role}
                  onChange={e => set('role', e.target.value)} required>
                  {roles.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  {t.deptAssign}{DEPT_ROLES.includes(form.role) && <span className="req"> *</span>}
                </label>
                <DepartmentSelect departments={deptOptions(depts, t)} value={form.dept_id}
                  onChange={v => set('dept_id', v)} t={t} emptyLabel={t.noDept || '—'} />
                <div className="form-hint">{DEPT_ROLES.includes(form.role) ? t.deptHint : t.deptOptionalHint}</div>
              </div>
              {isEdit && (
                <div className="form-group">
                  <label className="form-label">{t.active}</label>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={form.is_active}
                      onChange={e => set('is_active', e.target.checked)} />
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

// ── Bulk action bar ─────────────────────────────────────────────────────────
// Appears only when something is selected. Two independent actions rather than
// one combined form: setting a department and setting a role are separate
// decisions, and pairing them invites changing one by accident.
function BulkBar({ count, depts, t, busy, can, onApply, onClear }) {
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');

  return (
    <div className="usr-bulk">
      <div className="usr-bulk-count">
        <strong>{count}</strong> {t.usersAdmin.selected}
        <button className="btn btn-ghost btn-sm" onClick={onClear}>{t.usersAdmin.clearSel}</button>
      </div>

      <div className="usr-bulk-actions">
        <div className="usr-bulk-field">
          <select className="form-control form-control-sm" value={role} onChange={e => setRole(e.target.value)}>
            <option value="">{t.usersAdmin.setRole}</option>
            {VALID_ROLES.filter(r => (can.assignableRoles || VALID_ROLES).includes(r))
              .map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!role || busy}
            onClick={() => onApply({ role }).then(() => setRole(''))}>
            {t.usersAdmin.apply}
          </button>
        </div>

        <div className="usr-bulk-field">
          <select className="form-control form-control-sm" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">{t.usersAdmin.setDept}</option>
            {deptOptions(depts, t).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!dept || busy}
            onClick={() => onApply({ dept_id: dept }).then(() => setDept(''))}>
            {t.usersAdmin.apply}
          </button>
        </div>

        <div className="usr-bulk-sep" />
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onApply({ is_active: true })}>
          <CheckCircle size={13} strokeWidth={2} />{t.usersAdmin.activate}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onApply({ is_active: false })}>
          <XCircle size={13} strokeWidth={2} />{t.usersAdmin.deactivate}
        </button>
      </div>
    </div>
  );
}

// ── The system users table — the main screen ────────────────────────────────
function SystemUsers({ t, users, depts, loading, error, can, onReload, onEdit, onDelete, onBulk, deletingId }) {
  const u = t.usersAdmin;
  const [search, setSearch] = useState('');
  const [role,   setRole]   = useState('');
  const [dept,   setDept]   = useState('');
  const [sel,    setSel]    = useState(() => new Set());
  const [busy,   setBusy]   = useState(false);
  const [msg,    setMsg]    = useState('');

  const deptLabel = useCallback(
    id => (id ? (t.groupLabels?.[id] || depts.find(d => (d.ldapGroup || d.id) === id)?.label || id) : ''),
    [t, depts]
  );

  // Every field on screen is searchable, because people arrive here knowing
  // different things: a name, a four-digit extension, half an email address.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(x => {
      if (role && x.role !== role) return false;
      if (dept === '__none' ? x.dept_id : dept && x.dept_id !== dept) return false;
      if (!q) return true;
      return [x.full_name, x.username, x.ext, x.email, x.alt_email, x.mobile, deptLabel(x.dept_id), t.roles?.[x.role]]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [users, search, role, dept, deptLabel, t]);

  // A row HR may not change: a system administrator account. IT sees none
  // locked. Selecting one would only produce a refusal from the server, so the
  // checkbox goes too — the limit is visible before it is hit, not after.
  const locked = useCallback(
    x => can.scope === 'hr' && (x.is_protected || x.role === 'SUPER_ADMIN'),
    [can.scope]
  );

  const shownIds  = useMemo(() => shown.filter(x => !locked(x)).map(x => x.id), [shown, locked]);
  const allPicked = shownIds.length > 0 && shownIds.every(id => sel.has(id));

  function toggle(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel(prev => {
      const n = new Set(prev);
      if (allPicked) shownIds.forEach(id => n.delete(id));
      else shownIds.forEach(id => n.add(id));
      return n;
    });
  }

  async function applyBulk(patch) {
    setBusy(true); setMsg('');
    try {
      const n = await onBulk({ ids: [...sel], ...patch });
      setMsg(u.bulkDone.replace('{n}', n));
      setSel(new Set());
      setTimeout(() => setMsg(''), 3500);
    } catch (e) { setMsg(`ERR:${e.message}`); }
    finally { setBusy(false); }
  }

  // Counts drive the filter chips, so a chip never leads to an empty table.
  const roleCounts = useMemo(() => {
    const c = {};
    users.forEach(x => { c[x.role] = (c[x.role] || 0) + 1; });
    return c;
  }, [users]);

  const deptCounts = useMemo(() => {
    const c = { __none: 0 };
    users.forEach(x => { const k = x.dept_id || '__none'; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [users]);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{u.title}</h2>
          <div className="card-subtitle">
            {u.count.replace('{n}', users.length)}
            {shown.length !== users.length && ` · ${u.showing.replace('{n}', shown.length)}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <SearchBox value={search} onChange={setSearch} placeholder={u.searchPlaceholder} />
          <button className="btn btn-ghost btn-sm" onClick={onReload} title={t.refresh}>
            <RefreshCw size={14} strokeWidth={2} />
          </button>
          {can.createUsers && (
            <button className="btn btn-primary btn-sm" onClick={() => onEdit('create')}>
              <UserPlus size={14} strokeWidth={2} />{t.addUser}
            </button>
          )}
        </div>
      </div>

      <div className="corr-chiprow">
        <button className={`corr-filter${!role ? ' active' : ''}`} onClick={() => setRole('')}>
          {u.allRoles}
        </button>
        {ROLE_ORDER.filter(r => roleCounts[r]).map(r => (
          <button key={r} className={`corr-filter${role === r ? ' active' : ''}`} onClick={() => setRole(role === r ? '' : r)}>
            {t.roles?.[r] || r} <span className="usr-chip-n">{roleCounts[r]}</span>
          </button>
        ))}
      </div>

      <div className="usr-deptfilter">
        <select className="form-control form-control-sm" value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">{u.allDepts}</option>
          {deptCounts.__none > 0 && <option value="__none">{u.noDeptFilter} ({deptCounts.__none})</option>}
          {deptOptions(depts, t)
            .filter(d => deptCounts[d.id])
            .map(d => <option key={d.id} value={d.id}>{d.label} ({deptCounts[d.id]})</option>)}
        </select>
        {(role || dept || search) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setRole(''); setDept(''); setSearch(''); }}>
            {u.clearFilters}
          </button>
        )}
      </div>

      {can.scope === 'hr' && (
        <div className="usr-scope-note">
          <ShieldCheck size={14} strokeWidth={2} style={{ flexShrink: 0, marginBlockStart: '0.1rem' }} />
          <span>{u.hrNote}</span>
        </div>
      )}

      {!!sel.size && (
        <BulkBar count={sel.size} depts={depts} t={t} busy={busy} can={can}
          onApply={applyBulk} onClear={() => setSel(new Set())} />
      )}

      {msg && (
        <div className={`alert ${msg.startsWith('ERR:') ? 'alert-error' : 'alert-success'}`} style={{ margin: '0 1.25rem 0.75rem' }}>
          {msg.startsWith('ERR:') && <AlertTriangle size={14} strokeWidth={2} />}
          {msg.replace('ERR:', '')}
        </div>
      )}
      {error && <div className="alert alert-error" style={{ margin: '0 1.25rem 0.75rem' }}>{error}</div>}

      <div className="card-body">
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : !shown.length ? (
          <div className="empty-state">
            <div className="empty-icon"><Users size={30} strokeWidth={1.5} /></div>
            <div className="empty-sub">{users.length ? t.noResults : t.noUsers}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="usr-table">
              <thead>
                <tr>
                  <th className="usr-th-check">
                    <input type="checkbox" checked={allPicked} onChange={toggleAll}
                      aria-label={u.selectAll} title={u.selectAll} />
                  </th>
                  <th>{t.fullName}</th>
                  <th className="usr-th-ext">{t.directory.ext}</th>
                  <th>{t.email}</th>
                  <th>{t.deptAssign}</th>
                  <th>{t.role}</th>
                  <th>{t.active}</th>
                  <th className="usr-td-action" />
                </tr>
              </thead>
              <tbody>
                {shown.map(x => (
                  <tr key={x.id} className={[sel.has(x.id) && 'usr-picked', locked(x) && 'usr-locked-row']
                    .filter(Boolean).join(' ') || undefined}>
                    <td className="usr-th-check">
                      <input type="checkbox" checked={sel.has(x.id)} onChange={() => toggle(x.id)}
                        disabled={locked(x)} aria-label={x.full_name} />
                    </td>
                    {/* Name and username are one identity, so they share a cell.
                        Nine columns did not fit a 1366px screen in English, and
                        the column that fell off the end was the one with the
                        buttons in it. */}
                    <td>
                      <span className="usr-name">{x.full_name}</span>
                      {!x.is_ldap && <span className="usr-local" title={t.localUsersNote}>{u.localTag}</span>}
                      <code className="tag usr-username" dir="ltr">{x.username}</code>
                    </td>
                    <td>
                      {x.ext
                        ? <a className="dir-ext" href={`tel:${x.ext}`}><Phone size={11} strokeWidth={2.2} /><span>{x.ext}</span></a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {x.email
                        ? <a className="dir-plain dir-email" href={`mailto:${x.email}`} dir="ltr" title={x.email}>{x.email}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className={x.dept_id ? undefined : 'usr-missing'}>
                      {x.dept_id ? deptLabel(x.dept_id) : u.noDeptFilter}
                    </td>
                    <td><RoleBadge role={x.role} t={t} /></td>
                    <td><ActiveDot active={x.is_active} t={t} /></td>
                    <td className="usr-td-action">
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                        {locked(x)
                          ? <span className="usr-locked" title={u.itOnly}><Lock size={13} strokeWidth={2} /></span>
                          : (
                            <button className="btn btn-sm btn-ghost" onClick={() => onEdit(x)} title={t.edit}>
                              <Edit2 size={13} strokeWidth={2} />
                            </button>
                          )}
                        {can.deleteUsers && !x.is_ldap && (
                          <button className="btn btn-sm btn-ghost usr-del" onClick={() => onDelete(x)}
                            disabled={deletingId === x.id} title={t.del}>
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Active Directory accounts with no role yet ──────────────────────────────
// Collapsed by default: after the directory link this is a short tail of
// service accounts and new starters, not the main event.
function UnassignedLdap({ t, knownUsernames, depts, onAssigned }) {
  const u = t.usersAdmin;
  const [open,  setOpen]  = useState(false);
  const [list,  setList]  = useState(null);
  const [err,   setErr]   = useState('');
  const [busy,  setBusy]  = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setBusy(true); setErr('');
    getLdapUsers()
      .then(r => setList(r.users || []))
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { if (open && list === null) load(); }, [open, list, load]);

  const unassigned = (list || []).filter(x => !knownUsernames.has(String(x.username || '').toLowerCase()));
  const shown = unassigned.filter(x => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [x.name, x.username, x.email, x.department, x.title].some(v => String(v || '').toLowerCase().includes(q));
  });

  return (
    <div className="card" style={{ marginTop: '1.25rem' }}>
      <button className="usr-disclose" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Network size={17} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
        <span>
          <span className="card-title">{u.unassignedTitle}</span>
          <span className="card-subtitle">
            {list === null ? u.unassignedHint : u.unassignedCount.replace('{n}', unassigned.length)}
          </span>
        </span>
        <ChevronDown size={16} strokeWidth={2} className={open ? 'usr-chev open' : 'usr-chev'} />
      </button>

      {open && (
        <>
          {err && (
            <div className="alert alert-error" style={{ margin: '0 1.25rem 0.75rem' }}>
              <AlertTriangle size={14} strokeWidth={2} />
              <span>{err.includes('NOT_CONFIGURED') || err.includes('not configured') ? t.ldapNotConfigured : err}</span>
            </div>
          )}
          <div className="corr-chiprow" style={{ justifyContent: 'space-between' }}>
            <SearchBox value={search} onChange={setSearch} placeholder={t.search} />
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy}>
              <RefreshCw size={14} strokeWidth={2} />{t.refresh}
            </button>
          </div>
          <div className="card-body">
            {busy && list === null ? (
              <div className="page-loading"><div className="spinner" /></div>
            ) : !shown.length ? (
              <div className="empty-state"><div className="empty-sub">{u.allAssigned}</div></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t.fullName}</th><th>{t.username}</th><th>{t.email}</th>
                      <th>{t.ldapTitle}</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x, i) => (
                      <tr key={x.username || i}>
                        <td style={{ fontWeight: 500 }}>{x.name || '—'}</td>
                        <td><code className="tag" dir="ltr">{x.username}</code></td>
                        <td className="text-muted" dir="ltr">{x.email || '—'}</td>
                        <td className="text-muted">{x.title || '—'}</td>
                        <td className="usr-td-action">
                          <button className="btn btn-primary btn-sm" onClick={() => setModal(x)}>
                            <ShieldCheck size={12} strokeWidth={2} />{t.assignRole}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {modal && (
        <LdapRoleModal user={modal} depts={depts} t={t} onClose={() => setModal(null)}
          onSave={async payload => { await assignLdapRole(payload); onAssigned?.(); }} />
      )}
    </div>
  );
}

// ── Audit trail ─────────────────────────────────────────────────────────────
// Every change to a user is recorded server-side; this is where مدير النظام
// reads it back. Collapsed by default and loaded on open, so the page does not
// pay for it until someone asks.
const ACTION_KEY = {
  'user.create': 'created', 'user.update': 'updated', 'user.delete': 'deleted',
  'user.role_assign': 'roleAssigned', 'users.bulk_update': 'bulkUpdated',
};

function fieldList(t, changed) {
  const label = { role: t.role, dept_id: t.deptAssign, is_active: t.active,
                  full_name: t.fullName, email: t.email,
                  ext: t.directory.ext, mobile: t.directory.mobile,
                  password: t.password };
  return Object.entries(changed || {}).map(([k, v]) => {
    const name = label[k] || k;
    if (v && typeof v === 'object' && 'from' in v) {
      const val = x => {
        if (k === 'role')      return t.roles?.[x] || x || '—';
        if (k === 'is_active') return x ? t.active : t.inactive;
        return (x === '' || x == null) ? '—' : String(x);
      };
      return `${name}: ${val(v.from)} → ${val(v.to)}`;
    }
    return `${name}: ${v}`;
  });
}

function AuditPanel({ t }) {
  const a = t.usersAdmin;
  const [open, setOpen]   = useState(false);
  const [logs, setLogs]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');
  const [q,    setQ]      = useState('');

  const load = useCallback(() => {
    setBusy(true); setErr('');
    getAuditLog({ limit: 200 })
      .then(r => setLogs(r.logs || []))
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { if (open && logs === null) load(); }, [open, logs, load]);

  const shown = (logs || []).filter(l => {
    if (!/^users?\./.test(l.action)) return false;     // this panel is about people
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [l.actor_username, l.action, l.details].some(v => String(v || '').toLowerCase().includes(needle));
  });

  return (
    <div className="card" style={{ marginTop: '1.25rem' }}>
      <button className="usr-disclose" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <History size={17} strokeWidth={1.7} style={{ color: 'var(--text-2)' }} />
        <span>
          <span className="card-title">{a.auditTitle}</span>
          <span className="card-subtitle">{a.auditHint}</span>
        </span>
        <ChevronDown size={16} strokeWidth={2} className={open ? 'usr-chev open' : 'usr-chev'} />
      </button>

      {open && (
        <>
          <div className="corr-chiprow" style={{ justifyContent: 'space-between' }}>
            <SearchBox value={q} onChange={setQ} placeholder={t.search} />
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy}>
              <RefreshCw size={14} strokeWidth={2} />{t.refresh}
            </button>
          </div>
          <div className="card-body">
            {err && <div className="alert alert-error">{err}</div>}
            {busy && logs === null ? (
              <div className="page-loading"><div className="spinner" /></div>
            ) : !shown.length ? (
              <div className="empty-state"><div className="empty-sub">{a.auditEmpty}</div></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{a.auditWhen}</th><th>{a.auditWho}</th><th>{a.auditWhat}</th><th>{a.auditDetail}</th></tr>
                  </thead>
                  <tbody>
                    {shown.map(l => {
                      let d = {};
                      try { d = JSON.parse(l.details || '{}'); } catch { /* keep it empty */ }
                      const lines = d.targets
                        ? [a.auditPeople.replace('{n}', d.targets.length),
                           ...fieldList(t, Object.fromEntries(
                             Object.entries(d.changed || {}).filter(([, v]) => v !== undefined)
                               .map(([k, v]) => [k, String(k === 'role' ? (t.roles?.[v] || v) : v)])))]
                        : fieldList(t, d.changed);
                      return (
                        <tr key={l.id}>
                          <td className="usr-audit-when">{String(l.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                          <td><code className="tag" dir="ltr">{l.actor_username}</code></td>
                          <td>{a.actions?.[ACTION_KEY[l.action]] || l.action}</td>
                          <td className="usr-audit-detail">
                            {d.username && <code className="tag" dir="ltr">{d.username}</code>}
                            {lines.length
                              ? <span>{lines.join(' · ')}</span>
                              : (!d.username && <span className="text-muted">—</span>)}
                            {d.targets && (
                              <span className="text-muted" dir="ltr">
                                {' '}{d.targets.slice(0, 6).map(x => x.username).join(', ')}
                                {d.targets.length > 6 ? ` +${d.targets.length - 6}` : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Roles reference ─────────────────────────────────────────────────────────
function RolesGuide({ t, users }) {
  const [open, setOpen] = useState(false);
  const counts = ROLE_ORDER.reduce((a, r) => ({ ...a, [r]: users.filter(u => u.role === r).length }), {});

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <button className="usr-disclose" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <ShieldCheck size={17} strokeWidth={1.7} style={{ color: 'var(--primary)' }} />
        <span>
          <span className="card-title">{t.rolesGuide}</span>
          <span className="card-subtitle">{t.rolesGuideNote}</span>
        </span>
        <ChevronDown size={16} strokeWidth={2} className={open ? 'usr-chev open' : 'usr-chev'} />
      </button>
      {open && (
        <div className="usr-roles">
          {ROLE_ORDER.filter(r => VALID_ROLES.includes(r) || counts[r]).map(role => (
            <div key={role} className="usr-role">
              <div className="usr-role-head">
                <RoleBadge role={role} t={t} />
                {counts[role] > 0 && <span className="usr-chip-n">{counts[role]}</span>}
              </div>
              <p>{t.roleDesc?.[role]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { t } = useLang();
  const [users,   setUsers]   = useState([]);
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [modal,   setModal]   = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  // The server decides what this administrator may do and says so on the list
  // response. The UI shapes itself around that answer rather than re-deriving
  // the rules, so the two can never disagree.
  const [can, setCan] = useState({ assignableRoles: VALID_ROLES, scope: 'system' });

  const load = useCallback(() => {
    setLoading(true); setError('');
    Promise.all([getUsers(), getDepartments()])
      .then(([ud, dd]) => {
        setUsers(ud.users || []);
        setDepts(dd || []);
        if (ud.can) setCan(ud.can);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const knownUsernames = useMemo(
    () => new Set(users.map(u => String(u.username || '').toLowerCase())),
    [users]
  );

  async function handleSave(form) {
    if (modal === 'create') {
      const { user } = await createUser(form);
      setUsers(p => [user, ...p]);
    } else {
      const { user } = await updateUser(modal.id, form);
      setUsers(p => p.map(u => (u.id === user.id ? user : u)));
    }
  }

  async function handleDelete(x) {
    if (!await confirm(t.confirmDel)) return;
    setDeletingId(x.id);
    try {
      await deleteUser(x.id);
      setUsers(p => p.filter(u => u.id !== x.id));
    } catch (e) { setError(e.message); }
    finally { setDeletingId(null); }
  }

  async function handleBulk(body) {
    const r = await bulkUpdateUsers(body);
    const byId = new Map((r.users || []).map(u => [u.id, u]));
    setUsers(p => p.map(u => byId.get(u.id) || u));
    return r.updated;
  }

  return (
    <div className="usr-page">
      {confirmDialog}
      <RolesGuide t={t} users={users} />
      <SystemUsers
        t={t} users={users} depts={depts} loading={loading} error={error} can={can}
        onReload={load} onEdit={setModal} onDelete={handleDelete}
        onBulk={handleBulk} deletingId={deletingId} />
      {can.browseDirectory && (
        <UnassignedLdap t={t} knownUsernames={knownUsernames} depts={depts} onAssigned={load} />
      )}
      <AuditPanel t={t} />

      {modal && (
        <UserModal
          initial={modal === 'create' ? null : modal}
          depts={depts} t={t} can={can} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
