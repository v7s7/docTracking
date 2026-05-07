import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/adminService';

const FIELD_TYPES  = ['text', 'number', 'textarea', 'select', 'date', 'email', 'checkbox'];
const VALID_ROLES  = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'READONLY'];
const ROLE_COLORS  = { SUPER_ADMIN: '#6c3483', ADMIN: '#1a56db', MANAGER: '#0e7c50', STAFF: '#b7770d', READONLY: '#888' };

function Badge({ role }) {
  return (
    <span style={{ background: ROLE_COLORS[role] || '#888', color: '#fff', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
      {role}
    </span>
  );
}

function Alert({ msg, type = 'error' }) {
  if (!msg) return null;
  const colors = {
    error:   { bg: '#fdf0f0', color: '#c0392b', border: '#f5c6cb' },
    success: { bg: '#f0fff4', color: '#276749', border: '#9ae6b4' },
  };
  const c = colors[type];
  return <div style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', fontSize: '0.875rem' }}>{msg}</div>;
}

// ── Field row form (used for both Add and Edit) ─────────────────
const blankField = { key: '', label: '', type: 'text', required: false, options: '', placeholder: '' };

function FieldForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || blankField);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <tr style={{ background: '#eef3ff' }}>
      <td style={s.td}>
        <input style={s.si} value={f.key} onChange={e => set('key', e.target.value)} placeholder="field_key" disabled={!!initial} />
      </td>
      <td style={s.td}><input style={s.si} value={f.label} onChange={e => set('label', e.target.value)} placeholder="Display Label" /></td>
      <td style={s.td}>
        <select style={s.si} value={f.type} onChange={e => set('type', e.target.value)}>
          {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td style={{ ...s.td, textAlign: 'center' }}>
        <input type="checkbox" checked={f.required} onChange={e => set('required', e.target.checked)} />
      </td>
      <td style={s.td}>
        {f.type === 'select'
          ? <input style={s.si} value={f.options} onChange={e => set('options', e.target.value)} placeholder="Option1, Option2, Option3" />
          : <input style={s.si} value={f.placeholder} onChange={e => set('placeholder', e.target.value)} placeholder="Placeholder text" />}
      </td>
      <td style={s.td}>
        <button style={s.btnSave} onClick={() => onSave(f)}>Save</button>
        <button style={{ ...s.btn, ...s.btnGhost }} onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

// ── Single department card ───────────────────────────────────────
function DeptCard({ dept, onUpdated, onDeleted }) {
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
    if (!window.confirm(`Delete "${dept.label}"? This cannot be undone.`)) return;
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
    if (!window.confirm(`Remove field "${key}"?`)) return;
    try {
      await api.deleteField(dept.id, key);
      onUpdated({ ...dept, fields: dept.fields.filter(f => f.key !== key) });
    } catch (e) { setErr(e.message); }
  }

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        {editing ? (
          <div style={{ display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={s.input} value={label} onChange={e => setLabel(e.target.value)} placeholder="Department label" />
            <input style={{ ...s.input, width: 200 }} value={group} onChange={e => setGroup(e.target.value)} placeholder="AD group CN (optional)" />
            <button style={s.btnSave} onClick={saveLabel}>Save</button>
            <button style={{ ...s.btn, ...s.btnGhost }} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
            <button style={s.toggle} onClick={() => setOpen(p => !p)}>{open ? '▾' : '▸'}</button>
            <strong>{dept.label}</strong>
            {dept.ldapGroup && <code style={s.code}>{dept.ldapGroup}</code>}
            <span style={{ color: '#aaa', fontSize: '0.8rem' }}>{dept.fields.length} field{dept.fields.length !== 1 ? 's' : ''}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!editing && <button style={{ ...s.btn, ...s.btnGhost }} onClick={() => setEditing(true)}>Edit</button>}
          <button style={{ ...s.btn, ...s.btnDanger }} onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <Alert msg={err} />

      {open && (
        <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
          <table style={s.table}>
            <thead>
              <tr>{['Key', 'Label', 'Type', 'Required', 'Options / Placeholder', 'Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {dept.fields.map(f =>
                editingF === f.key
                  ? <FieldForm key={f.key} initial={{ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '') }} onSave={handleSaveField} onCancel={() => setEditingF(null)} />
                  : (
                    <tr key={f.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={s.td}><code style={s.code}>{f.key}</code></td>
                      <td style={s.td}>{f.label}</td>
                      <td style={s.td}><span style={s.typeBadge}>{f.type}</span></td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{f.required ? '✓' : '—'}</td>
                      <td style={s.td}>{Array.isArray(f.options) ? f.options.join(', ') : (f.placeholder || <span style={{ color: '#ccc' }}>—</span>)}</td>
                      <td style={s.td}>
                        <button style={s.btn} onClick={() => setEditingF(f.key)}>Edit</button>
                        <button style={{ ...s.btn, ...s.btnDanger }} onClick={() => handleDeleteField(f.key)}>Del</button>
                      </td>
                    </tr>
                  )
              )}
              {addingF
                ? <FieldForm onSave={handleAddField} onCancel={() => setAddingF(false)} />
                : <tr><td colSpan={6} style={{ padding: '0.5rem' }}><button style={{ ...s.btn, ...s.btnSuccess }} onClick={() => setAddingF(true)}>+ Add Field</button></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Departments tab ──────────────────────────────────────────────
function DepartmentsTab() {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>Departments &amp; Fields</h3>
        <button style={s.btnPrimary} onClick={() => setAdding(p => !p)}>+ Add Department</button>
      </div>
      <Alert msg={err} />
      {adding && (
        <div style={{ ...s.card, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <input style={s.input} value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Department label *" />
          <input style={{ ...s.input, width: 200 }} value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="AD group CN (optional)" />
          <button style={s.btnPrimary} onClick={handleAdd}>Create</button>
          <button style={{ ...s.btn, ...s.btnGhost }} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {depts.map(d => (
        <DeptCard key={d.id} dept={d}
          onUpdated={u => setDepts(p => p.map(x => x.id === u.id ? u : x))}
          onDeleted={id => setDepts(p => p.filter(x => x.id !== id))} />
      ))}
    </div>
  );
}

// ── Role Map tab ─────────────────────────────────────────────────
function RoleMapTab() {
  const [map, setMap]       = useState({});
  const [newGroup, setNG]   = useState('');
  const [newRole, setNR]    = useState('STAFF');
  const [editingG, setEG]   = useState(null);
  const [editRole, setER]   = useState('STAFF');
  const [err, setErr]       = useState('');

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
    if (!window.confirm(`Remove mapping for "${group}"?`)) return;
    try { const { roleGroupMap } = await api.deleteRoleEntry(group); setMap(roleGroupMap); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>LDAP Group → Role Mappings</h3>
      <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>AD group name (CN only, lowercase) mapped to a system role. Changes apply on the user's next login.</p>
      <Alert msg={err} />
      <table style={{ ...s.table, marginBottom: '1.5rem' }}>
        <thead><tr><th style={s.th}>AD Group (CN)</th><th style={s.th}>Role</th><th style={s.th}>Actions</th></tr></thead>
        <tbody>
          {Object.entries(map).map(([group, role]) => (
            <tr key={group} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={s.td}><code style={s.code}>{group}</code></td>
              <td style={s.td}>
                {editingG === group
                  ? <select style={s.si} value={editRole} onChange={e => setER(e.target.value)}>{VALID_ROLES.map(r => <option key={r}>{r}</option>)}</select>
                  : <Badge role={role} />}
              </td>
              <td style={s.td}>
                {editingG === group ? (
                  <><button style={s.btnSave} onClick={() => handleUpdate(group)}>Save</button><button style={{ ...s.btn, ...s.btnGhost }} onClick={() => setEG(null)}>Cancel</button></>
                ) : (
                  <><button style={s.btn} onClick={() => { setEG(group); setER(role); }}>Edit</button><button style={{ ...s.btn, ...s.btnDanger }} onClick={() => handleDelete(group)}>Del</button></>
                )}
              </td>
            </tr>
          ))}
          <tr style={{ background: '#f0f4ff' }}>
            <td style={s.td}><input style={s.si} value={newGroup} onChange={e => setNG(e.target.value)} placeholder="new_group_cn" /></td>
            <td style={s.td}><select style={s.si} value={newRole} onChange={e => setNR(e.target.value)}>{VALID_ROLES.map(r => <option key={r}>{r}</option>)}</select></td>
            <td style={s.td}><button style={{ ...s.btn, ...s.btnSuccess }} onClick={handleAdd}>+ Add</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Config tab ───────────────────────────────────────────────────
function ConfigTab() {
  const [raw, setRaw]       = useState('');
  const [msg, setMsg]       = useState({ text: '', type: 'error' });

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
      setMsg({ text: 'Config imported and applied successfully.', type: 'success' }); setRaw('');
    } catch (e) { setMsg({ text: e.name === 'SyntaxError' ? 'Invalid JSON.' : e.message, type: 'error' }); }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 0.5rem 0' }}>Config Export / Import</h3>
      <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>
        All settings are stored in <code style={s.code}>server/config/departments.json</code>. You can also edit that file directly and restart the server.
      </p>
      <Alert msg={msg.text} type={msg.type} />
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button style={s.btnPrimary} onClick={handleExport}>⬇ Export as JSON</button>
        <button style={{ ...s.btn, ...s.btnGhost }} onClick={handlePreview}>Preview current config</button>
      </div>
      <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#333', display: 'block', marginBottom: '0.4rem' }}>Paste JSON to import (replaces everything):</label>
      <textarea
        style={{ width: '100%', height: 260, fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', resize: 'vertical', boxSizing: 'border-box' }}
        value={raw} onChange={e => { setRaw(e.target.value); setMsg({ text: '', type: 'error' }); }}
        placeholder='{"departments": [...], "roleGroupMap": {...}}'
      />
      <button style={{ ...s.btnPrimary, marginTop: '0.5rem', opacity: raw.trim() ? 1 : 0.5 }} onClick={handleImport} disabled={!raw.trim()}>⬆ Import &amp; Apply</button>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────
export default function SuperAdminPanel({ onBack }) {
  const [tab, setTab] = useState('departments');
  const tabs = [
    { id: 'departments', label: '🏢 Departments & Fields' },
    { id: 'rolemap',     label: '🔑 Role Mappings' },
    { id: 'config',      label: '⚙ Config' },
  ];
  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0, color: '#6c3483' }}>Super Admin Panel</h2>
          <p style={{ margin: '0.2rem 0 0', color: '#888', fontSize: '0.875rem' }}>Manage departments, workflow fields, and role mappings</p>
        </div>
        {onBack && <button style={{ ...s.btn, ...s.btnGhost }} onClick={onBack}>← Back</button>}
      </div>
      <div style={s.tabs}>
        {tabs.map(t => <button key={t.id} style={{ ...s.tabBtn, ...(tab === t.id ? s.tabActive : {}) }} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div style={s.tabContent}>
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'rolemap'     && <RoleMapTab />}
        {tab === 'config'      && <ConfigTab />}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────
const s = {
  page:      { padding: '1.5rem', maxWidth: 980, margin: '0 auto' },
  tabs:      { display: 'flex', borderBottom: '2px solid #e0e0e0', marginBottom: '1.5rem', gap: '0.25rem' },
  tabBtn:    { padding: '0.55rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#555', borderBottom: '3px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#6c3483', borderBottomColor: '#6c3483', fontWeight: 700 },
  tabContent:{},
  card:      { border: '1px solid #e8e8e8', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#fafafa' },
  cardHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', background: '#fff', border: '1px solid #eee', borderRadius: 6 },
  th:        { background: '#f5f5f5', padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #eee' },
  td:        { padding: '0.45rem 0.75rem', verticalAlign: 'middle' },
  input:     { padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem', minWidth: 180 },
  si:        { padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem', width: '100%' },
  code:      { background: '#f0f0f0', padding: '1px 6px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.85em' },
  typeBadge: { background: '#e8f4fd', color: '#1a56db', padding: '1px 8px', borderRadius: 10, fontSize: '0.8rem' },
  toggle:    { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0 0.2rem' },
  btn:       { padding: '0.3rem 0.75rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', marginRight: '0.3rem' },
  btnSave:   { padding: '0.3rem 0.75rem', background: '#276749', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', marginRight: '0.3rem' },
  btnGhost:  { background: '#fff', color: '#444', border: '1px solid #ccc' },
  btnDanger: { background: '#e53e3e', border: 'none', color: '#fff' },
  btnSuccess:{ background: '#276749', border: 'none', color: '#fff' },
  btnPrimary:{ padding: '0.5rem 1.2rem', background: '#6c3483', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 },
};
