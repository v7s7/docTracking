import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import * as api from '../../services/adminService';
import { AlertTriangle, Check, Building2, Key, Settings } from 'lucide-react';

const FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'READONLY'];

const ROLE_COLORS = {
  SUPER_ADMIN: '#6c3483',
  ADMIN:       '#1a56db',
  MANAGER:     '#0e7c50',
  STAFF:       '#b7770d',
  READONLY:    '#718096',
};

function RoleBadge({ role }) {
  const { t } = useLang();
  return (
    <span className="badge" style={{ background: ROLE_COLORS[role] || '#888', color: '#fff' }}>
      {t.roles?.[role] || role}
    </span>
  );
}

function Alert({ msg, type = 'error' }) {
  if (!msg) return null;
  return (
    <div className={`alert alert-${type}`} style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {type === 'error' ? <AlertTriangle size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={2} />}
      <span>{msg}</span>
    </div>
  );
}

// ── Field editor row ─────────────────────────────────────────
const blankField = { key: '', label: '', type: 'text', required: false, options: '', placeholder: '' };

function FieldFormRow({ initial, onSave, onCancel }) {
  const { t } = useLang();
  const [f, setF] = useState(initial || blankField);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <tr style={{ background: '#EBF1F8' }}>
      <td style={{ padding: '0.45rem 0.75rem' }}>
        <input
          className="form-control"
          style={{ minWidth: 110, fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.key}
          onChange={e => set('key', e.target.value)}
          placeholder={t.fieldKey}
          disabled={!!initial}
          dir="ltr"
        />
      </td>
      <td style={{ padding: '0.45rem 0.75rem' }}>
        <input
          className="form-control"
          style={{ minWidth: 120, fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.label}
          onChange={e => set('label', e.target.value)}
          placeholder={t.fieldLabel}
        />
      </td>
      <td style={{ padding: '0.45rem 0.75rem' }}>
        <select
          className="form-control"
          style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
          value={f.type}
          onChange={e => set('type', e.target.value)}
        >
          {FIELD_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
      </td>
      <td style={{ padding: '0.45rem 0.75rem', textAlign: 'center' }}>
        <input type="checkbox" checked={f.required} onChange={e => set('required', e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
      </td>
      <td style={{ padding: '0.45rem 0.75rem' }}>
        {f.type === 'select'
          ? <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} value={f.options} onChange={e => set('options', e.target.value)} placeholder={t.optionsPH} />
          : <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} value={f.placeholder} onChange={e => set('placeholder', e.target.value)} placeholder="Placeholder…" />
        }
      </td>
      <td style={{ padding: '0.45rem 0.75rem' }}>
        <button className="btn btn-sm btn-primary" style={{ marginInlineEnd: '0.3rem' }} onClick={() => onSave(f)}>{t.save}</button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>{t.cancel}</button>
      </td>
    </tr>
  );
}

// ── Department card ──────────────────────────────────────────
function DeptCard({ dept, onUpdated, onDeleted }) {
  const { t } = useLang();
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel]     = useState(dept.label);
  const [group, setGroup]     = useState(dept.ldapGroup);
  const [addingF, setAddingF] = useState(false);
  const [editingF, setEditingF] = useState(null);
  const [err, setErr]         = useState('');

  async function saveLabel() {
    try {
      const { department } = await api.updateDept(dept.id, { label, ldapGroup: group });
      onUpdated(department); setEditing(false);
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete() {
    if (!window.confirm(t.confirmDel)) return;
    try { await api.deleteDept(dept.id); onDeleted(dept.id); }
    catch (e) { setErr(e.message); }
  }

  function buildFieldBody(f) {
    return {
      key:      f.key.trim(),
      label:    f.label.trim(),
      type:     f.type,
      required: f.required,
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
    <div className="dept-card">
      <div className="dept-card-head">
        {editing ? (
          <div style={{ display: 'flex', gap: '0.6rem', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-control"
              style={{ minWidth: 200, fontSize: '0.875rem', padding: '0.4rem 0.65rem' }}
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={t.deptLabel}
            />
            <input
              className="form-control"
              style={{ minWidth: 180, fontSize: '0.875rem', padding: '0.4rem 0.65rem' }}
              value={group}
              onChange={e => setGroup(e.target.value)}
              placeholder={`${t.adGroup} (optional)`}
              dir="ltr"
            />
            <button className="btn btn-sm btn-primary" onClick={saveLabel}>{t.save}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>{t.cancel}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0 0.1rem', lineHeight: 1 }}
              onClick={() => setOpen(p => !p)}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▾' : '▸'}
            </button>
            <strong style={{ color: 'var(--text)' }}>{dept.label}</strong>
            {dept.ldapGroup && <code className="tag">{dept.ldapGroup}</code>}
            <span className="text-sm text-muted">{dept.fields.length} {t.fields}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          {!editing && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>{t.edit}</button>}
          <button className="btn btn-sm btn-danger" onClick={handleDelete}>{t.del}</button>
        </div>
      </div>

      <Alert msg={err} />

      {open && (
        <div style={{ padding: '0 0 0.75rem', borderTop: '1px solid var(--border)' }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[t.fieldKey, t.fieldLabel, t.fieldType, t.fieldReq, t.optPH, t.actions].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dept.fields.map(f =>
                  editingF === f.key
                    ? <FieldFormRow key={f.key} initial={{ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '') }} onSave={handleSaveField} onCancel={() => setEditingF(null)} />
                    : (
                      <tr key={f.key}>
                        <td><code className="tag">{f.key}</code></td>
                        <td>{f.label}</td>
                        <td>
                          <span style={{ background: 'var(--accent-light)', color: 'var(--accent-hover)', padding: '1px 8px', borderRadius: 99, fontSize: '0.78rem', fontWeight: 600 }}>
                            {f.type}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>{f.required ? <Check size={14} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> : '—'}</td>
                        <td style={{ color: 'var(--text-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {Array.isArray(f.options) ? f.options.join(', ') : (f.placeholder || <span style={{ color: '#ccc' }}>—</span>)}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost" style={{ marginInlineEnd: '0.3rem' }} onClick={() => setEditingF(f.key)}>{t.edit}</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteField(f.key)}>{t.del}</button>
                        </td>
                      </tr>
                    )
                )}
                {addingF
                  ? <FieldFormRow onSave={handleAddField} onCancel={() => setAddingF(false)} />
                  : (
                    <tr>
                      <td colSpan={6} style={{ padding: '0.6rem 0.75rem' }}>
                        <button className="btn btn-sm btn-primary" onClick={() => setAddingF(true)}>{t.addField}</button>
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Departments tab ──────────────────────────────────────────
function DepartmentsTab() {
  const { t } = useLang();
  const [depts, setDepts]     = useState([]);
  const [adding, setAdding]   = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    try { const { departments } = await api.getDepartments(); setDepts(departments); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newLabel.trim()) return;
    try {
      const { department } = await api.createDept({ label: newLabel.trim(), ldapGroup: newGroup.trim() });
      setDepts(p => [...p, department]); setNewLabel(''); setNewGroup(''); setAdding(false);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t.deptFields}</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(p => !p)}>{t.addDept}</button>
      </div>

      <Alert msg={err} />

      {adding && (
        <div className="card" style={{ padding: '1rem', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-control"
            style={{ minWidth: 200, fontSize: '0.875rem' }}
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder={`${t.deptLabel} *`}
          />
          <input
            className="form-control"
            style={{ minWidth: 180, fontSize: '0.875rem' }}
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            placeholder={`${t.adGroup} (optional)`}
            dir="ltr"
          />
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>{t.add}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t.cancel}</button>
        </div>
      )}

      {depts.map(d => (
        <DeptCard
          key={d.id}
          dept={d}
          onUpdated={u => setDepts(p => p.map(x => x.id === u.id ? u : x))}
          onDeleted={id => setDepts(p => p.filter(x => x.id !== id))}
        />
      ))}
    </div>
  );
}

// ── Role Map tab ─────────────────────────────────────────────
function RoleMapTab() {
  const { t } = useLang();
  const [map, setMap]     = useState({});
  const [newGroup, setNG] = useState('');
  const [newRole, setNR]  = useState('STAFF');
  const [editingG, setEG] = useState(null);
  const [editRole, setER] = useState('STAFF');
  const [err, setErr]     = useState('');

  const load = useCallback(async () => {
    try { const { roleGroupMap } = await api.getRoleMap(); setMap(roleGroupMap); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newGroup.trim()) return;
    try { const { roleGroupMap } = await api.setRoleMapEntry({ ldapGroup: newGroup.trim(), role: newRole }); setMap(roleGroupMap); setNG(''); }
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

  return (
    <div>
      <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem', fontWeight: 700 }}>{t.roleMap}</h3>
      <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>{t.ldapNote}</p>
      <Alert msg={err} />
      <div className="table-wrap" style={{ marginBottom: '1rem' }}>
        <table>
          <thead>
            <tr>
              <th>AD Group (CN)</th>
              <th>{t.fieldLabel}</th>
              <th>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(map).map(([group, role]) => (
              <tr key={group}>
                <td><code className="tag">{group}</code></td>
                <td>
                  {editingG === group
                    ? <select className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 'auto' }} value={editRole} onChange={e => setER(e.target.value)}>
                        {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                      </select>
                    : <RoleBadge role={role} />}
                </td>
                <td>
                  {editingG === group ? (
                    <>
                      <button className="btn btn-sm btn-primary" style={{ marginInlineEnd: '0.3rem' }} onClick={() => handleUpdate(group)}>{t.save}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEG(null)}>{t.cancel}</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-ghost" style={{ marginInlineEnd: '0.3rem' }} onClick={() => { setEG(group); setER(role); }}>{t.edit}</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(group)}>{t.del}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            <tr style={{ background: 'var(--surface-2)' }}>
              <td>
                <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} value={newGroup} onChange={e => setNG(e.target.value)} placeholder={t.newGroup} dir="ltr" />
              </td>
              <td>
                <select className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 'auto' }} value={newRole} onChange={e => setNR(e.target.value)}>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{t.roles?.[r] || r}</option>)}
                </select>
              </td>
              <td>
                <button className="btn btn-sm btn-primary" onClick={handleAdd}>+ {t.add}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Config tab ───────────────────────────────────────────────
function ConfigTab() {
  const { t } = useLang();
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
      <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem', fontWeight: 700 }}>{t.config}</h3>
      <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>{t.cfgNote}</p>
      <Alert msg={msg.text} type={msg.type} />
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={handleExport}>{t.exportJSON}</button>
        <button className="btn btn-ghost btn-sm" onClick={handlePreview}>{t.previewCfg}</button>
      </div>
      <label className="form-label" style={{ display: 'block', marginBottom: '0.4rem' }}>{t.importNote}</label>
      <textarea
        className="form-control"
        style={{ height: 260, fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
        value={raw}
        onChange={e => { setRaw(e.target.value); setMsg({ text: '', type: 'error' }); }}
        placeholder={t.importPH}
        dir="ltr"
      />
      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: '0.6rem', opacity: raw.trim() ? 1 : 0.5 }}
        onClick={handleImport}
        disabled={!raw.trim()}
      >
        {t.importCfg}
      </button>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────
export default function SuperAdminPanel() {
  const { t } = useLang();
  const [tab, setTab] = useState('departments');

  const tabs = [
    { id: 'departments', icon: <Building2 size={15} strokeWidth={1.8} />, label: t.deptFields },
    { id: 'rolemap',     icon: <Key       size={15} strokeWidth={1.8} />, label: t.roleMaps },
    { id: 'config',      icon: <Settings  size={15} strokeWidth={1.8} />, label: t.config },
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
            {tabs.map(tab_ => (
              <button
                key={tab_.id}
                className={`admin-tab${tab === tab_.id ? ' active' : ''}`}
                onClick={() => setTab(tab_.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {tab_.icon}{tab_.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body">
          {tab === 'departments' && <DepartmentsTab />}
          {tab === 'rolemap'     && <RoleMapTab />}
          {tab === 'config'      && <ConfigTab />}
        </div>
      </div>
    </div>
  );
}
