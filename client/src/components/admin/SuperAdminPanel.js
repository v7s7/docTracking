import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import * as api from '../../services/adminService';
import { getUsers } from '../../services/userService';
import {
  AlertTriangle, CheckCircle, Building2, Key, HardDrive,
  ChevronDown, ChevronRight, Plus, Edit2, Trash2, Info,
  Users, Settings2,
} from 'lucide-react';

const FIELD_TYPES  = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];
const VALID_ROLES  = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE', 'MANAGER', 'STAFF', 'READONLY'];
const ROLE_COLORS  = {
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

function Flash({ msg, type = 'error' }) {
  if (!msg) return null;
  return (
    <div className={`alert alert-${type}`} style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {type === 'error'
        ? <AlertTriangle size={14} strokeWidth={2} />
        : <CheckCircle  size={14} strokeWidth={2} />}
      <span>{msg}</span>
    </div>
  );
}

// ── Custom field editor row ──────────────────────────────────
const blankField = { key: '', label: '', type: 'text', required: false, options: '', placeholder: '' };

function FieldFormRow({ initial, onSave, onCancel, t }) {
  const [f, setF] = useState(initial || blankField);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <tr style={{ background: 'var(--primary-light)' }}>
      <td style={{ padding: '0.4rem 0.6rem' }}>
        <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.key} onChange={e => set('key', e.target.value)}
          placeholder={t.fieldKey} disabled={!!initial} dir="ltr" />
      </td>
      <td style={{ padding: '0.4rem 0.6rem' }}>
        <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.label} onChange={e => set('label', e.target.value)} placeholder={t.fieldLabel} />
      </td>
      <td style={{ padding: '0.4rem 0.6rem' }}>
        <select className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.type} onChange={e => set('type', e.target.value)}>
          {FIELD_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
      </td>
      <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>
        <input type="checkbox" checked={f.required} onChange={e => set('required', e.target.checked)}
          style={{ accentColor: 'var(--accent)' }} />
      </td>
      <td style={{ padding: '0.4rem 0.6rem' }}>
        {f.type === 'select'
          ? <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
              value={f.options} onChange={e => set('options', e.target.value)} placeholder={t.optionsPH} />
          : <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
              value={f.placeholder} onChange={e => set('placeholder', e.target.value)} placeholder="Placeholder…" />
        }
      </td>
      <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
        <button className="btn btn-sm btn-primary" style={{ marginInlineEnd: '0.3rem' }} onClick={() => onSave(f)}>{t.save}</button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>{t.cancel}</button>
      </td>
    </tr>
  );
}

// ── Department row ───────────────────────────────────────────
function DeptRow({ dept, userCount, onUpdated, onDeleted, t }) {
  const [open,      setOpen]      = useState(false);
  const [fieldsOpen,setFieldsOpen]= useState(false);
  const [editing,   setEditing]   = useState(false);
  const [showAdv,   setShowAdv]   = useState(false);
  const [label,     setLabel]     = useState(dept.label);
  const [group,     setGroup]     = useState(dept.ldapGroup || '');
  const [addingF,   setAddingF]   = useState(false);
  const [editingF,  setEditingF]  = useState(null);
  const [err,       setErr]       = useState('');

  async function saveLabel() {
    try {
      const { department } = await api.updateDept(dept.id, { label, ldapGroup: group });
      onUpdated(department); setEditing(false); setErr('');
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete() {
    if (!window.confirm(t.confirmDel)) return;
    try { await api.deleteDept(dept.id); onDeleted(dept.id); }
    catch (e) { setErr(e.message); }
  }

  function buildFieldBody(f) {
    return {
      key: f.key.trim(), label: f.label.trim(), type: f.type, required: f.required,
      ...(f.type === 'select' ? { options: f.options.split(',').map(x => x.trim()).filter(Boolean) } : {}),
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    };
  }

  async function handleAddField(f) {
    try {
      const { field } = await api.addField(dept.id, buildFieldBody(f));
      onUpdated({ ...dept, fields: [...dept.fields, field] }); setAddingF(false);
    } catch (e) { setErr(e.message); }
  }

  async function handleSaveField(f) {
    try {
      const body = { ...buildFieldBody(f), ...(f.type === 'select' ? { options: typeof f.options === 'string' ? f.options.split(',').map(x => x.trim()).filter(Boolean) : f.options } : {}) };
      const { field } = await api.updateField(dept.id, f.key, body);
      onUpdated({ ...dept, fields: dept.fields.map(fi => fi.key === field.key ? field : fi) }); setEditingF(null);
    } catch (e) { setErr(e.message); }
  }

  async function handleDeleteField(key) {
    if (!window.confirm(t.confirmDel)) return;
    try {
      await api.deleteField(dept.id, key);
      onUpdated({ ...dept, fields: dept.fields.filter(fi => fi.key !== key) });
    } catch (e) { setErr(e.message); }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: '0.6rem', background: 'var(--surface)', overflow: 'hidden' }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', flexWrap: 'wrap' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0, display: 'flex' }}
          onClick={() => setOpen(p => !p)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {editing ? (
          <div style={{ display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <input className="form-control" style={{ fontSize: '0.875rem', padding: '0.4rem 0.65rem' }}
                value={label} onChange={e => setLabel(e.target.value)} placeholder={t.deptLabel} />
            </div>
            <div>
              <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}
                onClick={() => setShowAdv(p => !p)}>
                <Settings2 size={12} strokeWidth={2} />{t.advancedOptions}
              </button>
            </div>
            {showAdv && (
              <div style={{ width: '100%' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', marginBottom: '0.25rem', display: 'block' }}>{t.adGroup}</label>
                <input className="form-control" style={{ maxWidth: 260, fontSize: '0.875rem', padding: '0.4rem 0.65rem' }}
                  value={group} onChange={e => setGroup(e.target.value)} placeholder="group_cn" dir="ltr" />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: '0.3rem 0 0' }}>{t.adGroupHint}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button className="btn btn-primary btn-sm" onClick={saveLabel}>{t.save}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setLabel(dept.label); setGroup(dept.ldapGroup || ''); }}>{t.cancel}</button>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.95rem' }}>{dept.label}</strong>
            {dept.ldapGroup && <code className="tag" style={{ fontSize: '0.75rem' }}>{dept.ldapGroup}</code>}
            {userCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--accent-hover)', background: 'var(--accent-light)', borderRadius: 20, padding: '0.1rem 0.55rem', fontWeight: 600 }}>
                <Users size={11} strokeWidth={2} />{userCount} {t.usersInDept}
              </span>
            )}
            {dept.fields.length > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                {dept.fields.length} {t.fields}
              </span>
            )}
          </div>
        )}

        {!editing && (
          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => setEditing(true)}>
              <Edit2 size={12} strokeWidth={2} />{t.edit}
            </button>
            <button className="btn btn-sm btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={handleDelete}>
              <Trash2 size={12} strokeWidth={2} />{t.del}
            </button>
          </div>
        )}
      </div>

      <Flash msg={err} />

      {/* Expanded: custom fields */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <button
            style={{ width: '100%', textAlign: 'start', padding: '0.6rem 1rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)' }}
            onClick={() => setFieldsOpen(p => !p)}>
            {fieldsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t.customFields}
            <span style={{ fontWeight: 400, color: 'var(--text-3)', marginInlineStart: '0.25rem' }}>— {t.customFieldsNote}</span>
          </button>

          {fieldsOpen && (
            <div style={{ padding: '0 1rem 1rem' }}>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {[t.fieldKey, t.fieldLabel, t.fieldType, t.fieldReq, t.optPH, t.actions].map(h => (
                        <th key={h} style={{ fontSize: '0.78rem' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dept.fields.map(f =>
                      editingF === f.key
                        ? <FieldFormRow key={f.key} t={t} initial={{ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '') }} onSave={handleSaveField} onCancel={() => setEditingF(null)} />
                        : (
                          <tr key={f.key}>
                            <td><code className="tag">{f.key}</code></td>
                            <td style={{ fontSize: '0.85rem' }}>{f.label}</td>
                            <td>
                              <span style={{ background: 'var(--accent-light)', color: 'var(--accent-hover)', padding: '1px 8px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 }}>
                                {f.type}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {f.required ? <CheckCircle size={13} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> : '—'}
                            </td>
                            <td style={{ color: 'var(--text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                              {Array.isArray(f.options) ? f.options.join(', ') : (f.placeholder || '—')}
                            </td>
                            <td>
                              <button className="btn btn-sm btn-ghost" style={{ marginInlineEnd: '0.3rem' }} onClick={() => setEditingF(f.key)}>{t.edit}</button>
                              <button className="btn btn-sm btn-danger" onClick={() => handleDeleteField(f.key)}>{t.del}</button>
                            </td>
                          </tr>
                        )
                    )}
                    {addingF
                      ? <FieldFormRow t={t} onSave={handleAddField} onCancel={() => setAddingF(false)} />
                      : (
                        <tr>
                          <td colSpan={6} style={{ padding: '0.5rem 0.6rem' }}>
                            <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                              onClick={() => setAddingF(true)}>
                              <Plus size={12} strokeWidth={2.5} />{t.addField}
                            </button>
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Departments tab ──────────────────────────────────────────
function DepartmentsTab({ t }) {
  const [depts,    setDepts]    = useState([]);
  const [userMap,  setUserMap]  = useState({}); // dept_id → count
  const [adding,   setAdding]   = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [showAdv,  setShowAdv]  = useState(false);
  const [err,      setErr]      = useState('');

  const load = useCallback(async () => {
    try {
      const [{ departments }, usersRes] = await Promise.all([
        api.getDepartments(),
        getUsers().catch(() => ({ users: [] })),
      ]);
      setDepts(departments);
      const map = {};
      (usersRes.users || []).forEach(u => {
        if (u.dept_id) map[u.dept_id] = (map[u.dept_id] || 0) + 1;
      });
      setUserMap(map);
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newLabel.trim()) return;
    try {
      const { department } = await api.createDept({ label: newLabel.trim(), ldapGroup: newGroup.trim() });
      setDepts(p => [...p, department]);
      setNewLabel(''); setNewGroup(''); setAdding(false); setShowAdv(false); setErr('');
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t.deptFields}</h3>
          <p className="text-sm text-muted" style={{ margin: '0.15rem 0 0' }}>{t.deptNote}</p>
        </div>
        <button className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={() => setAdding(p => !p)}>
          <Plus size={14} strokeWidth={2.5} />{t.addDept}
        </button>
      </div>

      <Flash msg={err} />

      {/* Add form */}
      {adding && (
        <div style={{ border: '1px solid var(--primary)', borderRadius: 10, padding: '1rem', marginBottom: '0.75rem', background: 'var(--primary-light)' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label" style={{ fontSize: '0.82rem' }}>{t.deptLabel} *</label>
              <input className="form-control" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Accounts Department" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAdd()} />
            </div>
            <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', marginBottom: '0.1rem' }}
              onClick={() => setShowAdv(p => !p)}>
              <Settings2 size={12} strokeWidth={2} />{t.advancedOptions}
            </button>
          </div>

          {showAdv && (
            <div style={{ marginTop: '0.75rem' }}>
              <label className="form-label" style={{ fontSize: '0.82rem' }}>{t.adGroup}</label>
              <input className="form-control" style={{ maxWidth: 280 }} value={newGroup}
                onChange={e => setNewGroup(e.target.value)} placeholder="group_cn" dir="ltr" />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: '0.3rem 0 0' }}>{t.adGroupHint}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!newLabel.trim()}>{t.add}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setNewLabel(''); setNewGroup(''); setShowAdv(false); }}>{t.cancel}</button>
          </div>
        </div>
      )}

      {/* Dept list */}
      {depts.length === 0 && !adding ? (
        <div className="empty-state" style={{ padding: '2.5rem' }}>
          <div className="empty-icon"><Building2 size={28} strokeWidth={1.4} /></div>
          <div className="empty-sub">{t.noDepts}</div>
        </div>
      ) : (
        depts.map(d => (
          <DeptRow key={d.id} dept={d} userCount={userMap[d.id] || 0} t={t}
            onUpdated={u => setDepts(p => p.map(x => x.id === u.id ? u : x))}
            onDeleted={id => setDepts(p => p.filter(x => x.id !== id))}
          />
        ))
      )}
    </div>
  );
}

// ── AD Auto-Roles tab ────────────────────────────────────────
function AutoRolesTab({ t }) {
  const [map,      setMap]   = useState({});
  const [newGroup, setNG]    = useState('');
  const [newRole,  setNR]    = useState('STAFF');
  const [editingG, setEG]    = useState(null);
  const [editRole, setER]    = useState('STAFF');
  const [err,      setErr]   = useState('');

  const load = useCallback(async () => {
    try { const { roleGroupMap } = await api.getRoleMap(); setMap(roleGroupMap); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newGroup.trim()) return;
    try { const { roleGroupMap } = await api.setRoleMapEntry({ ldapGroup: newGroup.trim(), role: newRole }); setMap(roleGroupMap); setNG(''); setErr(''); }
    catch (e) { setErr(e.message); }
  }
  async function handleUpdate(group) {
    try { const { roleGroupMap } = await api.setRoleMapEntry({ ldapGroup: group, role: editRole }); setMap(roleGroupMap); setEG(null); }
    catch (e) { setErr(e.message); }
  }
  async function handleDelete(group) {
    if (!window.confirm(t.confirmDel)) return;
    try { const { roleGroupMap } = await api.deleteRoleEntry(group); setMap(roleGroupMap); }
    catch (e) { setErr(e.message); }
  }

  const entries = Object.entries(map);

  return (
    <div>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 700 }}>{t.roleMaps}</h3>
      <p className="text-sm text-muted" style={{ marginBottom: '0.5rem' }}>{t.ldapNote}</p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: 'var(--accent-hover)' }}>
        <Info size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
        {t.adAutoRolesNote}
      </div>

      <Flash msg={err} />

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>AD Group CN</th>
              <th>{t.role}</th>
              <th>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1.5rem', fontSize: '0.85rem' }}>—</td></tr>
            )}
            {entries.map(([group, role]) => (
              <tr key={group}>
                <td><code className="tag">{group}</code></td>
                <td>
                  {editingG === group
                    ? <select className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 'auto' }}
                        value={editRole} onChange={e => setER(e.target.value)}>
                        {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                      </select>
                    : <RoleBadge role={role} t={t} />}
                </td>
                <td>
                  {editingG === group ? (
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => handleUpdate(group)}>{t.save}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEG(null)}>{t.cancel}</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => { setEG(group); setER(role); }}>
                        <Edit2 size={11} strokeWidth={2} />{t.edit}
                      </button>
                      <button className="btn btn-sm btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => handleDelete(group)}>
                        <Trash2 size={11} strokeWidth={2} />{t.del}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {/* Inline add row */}
            <tr style={{ background: 'var(--surface-2)' }}>
              <td style={{ padding: '0.5rem 0.75rem' }}>
                <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
                  value={newGroup} onChange={e => setNG(e.target.value)}
                  placeholder={t.newGroup} dir="ltr"
                  onKeyDown={e => e.key === 'Enter' && handleAdd()} />
              </td>
              <td style={{ padding: '0.5rem 0.75rem' }}>
                <select className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 'auto' }}
                  value={newRole} onChange={e => setNR(e.target.value)}>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                </select>
              </td>
              <td style={{ padding: '0.5rem 0.75rem' }}>
                <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                  onClick={handleAdd} disabled={!newGroup.trim()}>
                  <Plus size={13} strokeWidth={2.5} />{t.add}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Backup tab ───────────────────────────────────────────────
function BackupTab({ t }) {
  const [raw, setRaw] = useState('');
  const [msg, setMsg] = useState({ text: '', type: 'error' });

  async function handleExport() {
    try {
      const { config } = await api.getConfig();
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: 'doctracking-config.json' });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMsg({ text: e.message, type: 'error' }); }
  }

  async function handlePreview() {
    try { const { config } = await api.getConfig(); setRaw(JSON.stringify(config, null, 2)); }
    catch (e) { setMsg({ text: e.message, type: 'error' }); }
  }

  async function handleImport() {
    try {
      const cfg = JSON.parse(raw);
      await api.replaceConfig(cfg);
      setMsg({ text: t.submitted, type: 'success' }); setRaw('');
    } catch (e) {
      setMsg({ text: e.name === 'SyntaxError' ? 'Invalid JSON.' : e.message, type: 'error' });
    }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 700 }}>{t.config}</h3>
      <p className="text-sm text-muted" style={{ marginBottom: '1.25rem' }}>{t.cfgNote}</p>
      <Flash msg={msg.text} type={msg.type} />
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={handleExport}>
          <HardDrive size={14} strokeWidth={2} />{t.exportJSON}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handlePreview}>{t.previewCfg}</button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <label className="form-label" style={{ display: 'block', marginBottom: '0.4rem' }}>{t.importNote}</label>
        <textarea
          className="form-control"
          style={{ height: 220, fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
          value={raw}
          onChange={e => { setRaw(e.target.value); setMsg({ text: '', type: 'error' }); }}
          placeholder={t.importPH}
          dir="ltr"
        />
        <button className="btn btn-primary btn-sm" style={{ marginTop: '0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={handleImport} disabled={!raw.trim()}>
          <HardDrive size={14} strokeWidth={2} />{t.importCfg}
        </button>
      </div>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────
export default function SuperAdminPanel() {
  const { t } = useLang();
  const [tab, setTab] = useState('departments');

  const tabs = [
    { id: 'departments', icon: <Building2  size={15} strokeWidth={1.8} />, label: t.deptFields },
    { id: 'autoroles',   icon: <Key        size={15} strokeWidth={1.8} />, label: t.roleMaps },
    { id: 'backup',      icon: <HardDrive  size={15} strokeWidth={1.8} />, label: t.config },
  ];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary)' }}>{t.adminPanel}</h2>
        <p className="text-sm text-muted" style={{ marginTop: '0.2rem' }}>{t.deptFields} · {t.roleMaps} · {t.config}</p>
      </div>

      <div className="card">
        <div style={{ padding: '0 1.5rem' }}>
          <div className="admin-tabs">
            {tabs.map(tb => (
              <button key={tb.id}
                className={`admin-tab${tab === tb.id ? ' active' : ''}`}
                onClick={() => setTab(tb.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                {tb.icon}{tb.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {tab === 'departments' && <DepartmentsTab t={t} />}
          {tab === 'autoroles'   && <AutoRolesTab  t={t} />}
          {tab === 'backup'      && <BackupTab     t={t} />}
        </div>
      </div>
    </div>
  );
}
