import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../services/adminService';
import { getUsers } from '../../services/userService';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../services/templateService';
import { getSessions, forceLogout as forceLogoutApi } from '../../services/sessionService';
import { getAuditLog } from '../../services/auditService';
import {
  AlertTriangle, CheckCircle, Building2, Key, HardDrive,
  ChevronDown, ChevronRight, Plus, Edit2, Trash2, Info,
  Users, Settings2, LayoutTemplate, Monitor, Activity,
  LogOut, RefreshCw, ChevronLeft, Filter, ClipboardList,
} from 'lucide-react';
import { useConfirm } from '../common/ConfirmDialog';

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

// ── Field form row (reused for service fields) ────────────────
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

// ── Service row (nested inside DeptRow) ───────────────────────
function ServiceRow({ deptId, service, onUpdated, onDeleted, t }) {
  const [open,      setOpen]     = useState(false);
  const [editing,   setEditing]  = useState(false);
  const [label,     setLabel]    = useState(service.label);
  const [desc,      setDesc]     = useState(service.description || '');
  const [addingF,   setAddingF]  = useState(false);
  const [editingF,  setEditingF] = useState(null);
  const [err,       setErr]      = useState('');
  const [confirm, confirmDialog] = useConfirm();

  async function saveLabel() {
    try {
      const { service: updated } = await api.updateService(deptId, service.id, { label, description: desc });
      onUpdated(updated); setEditing(false); setErr('');
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete() {
    if (!await confirm(t.confirmDel)) return;
    try { await api.deleteService(deptId, service.id); onDeleted(service.id); }
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
      const { field } = await api.addField(deptId, service.id, buildFieldBody(f));
      onUpdated({ ...service, fields: [...(service.fields || []), field] }); setAddingF(false);
    } catch (e) { setErr(e.message); }
  }

  async function handleSaveField(f) {
    try {
      const body = { ...buildFieldBody(f), ...(f.type === 'select' ? { options: typeof f.options === 'string' ? f.options.split(',').map(x => x.trim()).filter(Boolean) : f.options } : {}) };
      const { field } = await api.updateField(deptId, service.id, f.key, body);
      onUpdated({ ...service, fields: (service.fields || []).map(fi => fi.key === field.key ? field : fi) });
      setEditingF(null);
    } catch (e) { setErr(e.message); }
  }

  async function handleDeleteField(key) {
    if (!await confirm(t.confirmDel)) return;
    try {
      await api.deleteField(deptId, service.id, key);
      onUpdated({ ...service, fields: (service.fields || []).filter(fi => fi.key !== key) });
    } catch (e) { setErr(e.message); }
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, marginBottom: '0.4rem',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      {confirmDialog}
      {/* Service header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem', flexWrap: 'wrap' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0, display: 'flex' }}
          onClick={() => setOpen(p => !p)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <ClipboardList size={14} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />

        {editing ? (
          <div style={{ display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <input className="form-control" style={{ fontSize: '0.82rem', padding: '0.3rem 0.6rem', marginBottom: '0.3rem' }}
                value={label} onChange={e => setLabel(e.target.value)} placeholder="اسم الخدمة" />
              <input className="form-control" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                value={desc} onChange={e => setDesc(e.target.value)} placeholder="وصف مختصر (اختياري)" />
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignSelf: 'flex-start', paddingTop: '0.1rem' }}>
              <button className="btn btn-primary btn-sm" onClick={saveLabel}>{t.save}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setLabel(service.label); setDesc(service.description || ''); }}>{t.cancel}</button>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{service.label}</span>
            {service.description && (
              <span style={{ marginInlineStart: '0.5rem', fontSize: '0.75rem', color: 'var(--text-3)' }}>{service.description}</span>
            )}
            <span style={{ marginInlineStart: '0.5rem', fontSize: '0.72rem', color: 'var(--text-3)' }}>
              · {(service.fields || []).length} {t.fields || 'حقول'}
            </span>
          </div>
        )}

        {!editing && (
          <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
            <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem' }}
              onClick={() => setEditing(true)}>
              <Edit2 size={11} strokeWidth={2} />{t.edit}
            </button>
            <button className="btn btn-sm btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem' }}
              onClick={handleDelete}>
              <Trash2 size={11} strokeWidth={2} />{t.del}
            </button>
          </div>
        )}
      </div>

      {err && <div style={{ padding: '0 0.85rem' }}><Flash msg={err} /></div>}

      {/* Fields table */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', padding: '0.65rem 0.85rem' }}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {[t.fieldKey, t.fieldLabel, t.fieldType, t.fieldReq, t.optPH, t.actions].map(h => (
                    <th key={h} style={{ fontSize: '0.76rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(service.fields || []).map(f =>
                  editingF === f.key
                    ? <FieldFormRow key={f.key} t={t} initial={{ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '') }} onSave={handleSaveField} onCancel={() => setEditingF(null)} />
                    : (
                      <tr key={f.key}>
                        <td><code className="tag">{f.key}</code></td>
                        <td style={{ fontSize: '0.82rem' }}>{f.label}</td>
                        <td>
                          <span style={{ background: 'var(--accent-light)', color: 'var(--accent-hover)', padding: '1px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 600 }}>
                            {f.type}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {f.required ? <CheckCircle size={12} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> : '—'}
                        </td>
                        <td style={{ color: 'var(--text-2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                          {Array.isArray(f.options) ? f.options.join(', ') : (f.placeholder || '—')}
                        </td>
                        <td>
                          <button className="btn btn-sm btn-ghost" style={{ marginInlineEnd: '0.25rem', fontSize: '0.78rem' }} onClick={() => setEditingF(f.key)}>{t.edit}</button>
                          <button className="btn btn-sm btn-danger" style={{ fontSize: '0.78rem' }} onClick={() => handleDeleteField(f.key)}>{t.del}</button>
                        </td>
                      </tr>
                    )
                )}
                {addingF
                  ? <FieldFormRow t={t} onSave={handleAddField} onCancel={() => setAddingF(false)} />
                  : (
                    <tr>
                      <td colSpan={6} style={{ padding: '0.4rem 0.5rem' }}>
                        <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}
                          onClick={() => setAddingF(true)}>
                          <Plus size={11} strokeWidth={2.5} />{t.addField}
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
  );
}

// ── Department row ─────────────────────────────────────────────
function DeptRow({ dept, userCount, onUpdated, onDeleted, t }) {
  const [open,      setOpen]      = useState(false);
  const [editing,   setEditing]   = useState(false);
  const [showAdv,   setShowAdv]   = useState(false);
  const [label,     setLabel]     = useState(dept.label);
  const [group,     setGroup]     = useState(dept.ldapGroup || '');
  const [addingSvc, setAddingSvc] = useState(false);
  const [newSvcLabel, setNewSvcLabel] = useState('');
  const [newSvcDesc,  setNewSvcDesc]  = useState('');
  const [err,       setErr]       = useState('');
  const [confirm, confirmDialog] = useConfirm();

  const services = dept.services || [];

  async function saveLabel() {
    try {
      const { department } = await api.updateDept(dept.id, { label, ldapGroup: group });
      onUpdated(department); setEditing(false); setErr('');
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete() {
    if (!await confirm(t.confirmDel)) return;
    try { await api.deleteDept(dept.id); onDeleted(dept.id); }
    catch (e) { setErr(e.message); }
  }

  async function handleAddService() {
    if (!newSvcLabel.trim()) return;
    try {
      const { service } = await api.createService(dept.id, { label: newSvcLabel.trim(), description: newSvcDesc.trim() });
      onUpdated({ ...dept, services: [...services, service] });
      setNewSvcLabel(''); setNewSvcDesc(''); setAddingSvc(false); setErr('');
    } catch (e) { setErr(e.message); }
  }

  function handleSvcUpdated(updated) {
    onUpdated({ ...dept, services: services.map(s => s.id === updated.id ? updated : s) });
  }

  function handleSvcDeleted(svcId) {
    onUpdated({ ...dept, services: services.filter(s => s.id !== svcId) });
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: '0.6rem', background: 'var(--surface)', overflow: 'hidden' }}>
      {confirmDialog}
      {/* Dept header */}
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
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
              {services.length} خدمة
            </span>
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

      {/* Services list */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', padding: '0.75rem 1rem 0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-2)' }}>
              الخدمات / أنواع المعاملات
            </span>
            {!addingSvc && (
              <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
                onClick={() => setAddingSvc(true)}>
                <Plus size={12} strokeWidth={2.5} /> إضافة خدمة
              </button>
            )}
          </div>

          {/* Add service form */}
          {addingSvc && (
            <div style={{ border: '1px solid var(--primary)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.65rem', background: 'var(--primary-light)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="form-label" style={{ fontSize: '0.78rem' }}>اسم الخدمة *</label>
                  <input className="form-control" value={newSvcLabel} onChange={e => setNewSvcLabel(e.target.value)}
                    placeholder="مثال: إعانة زواج" autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleAddService()} />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="form-label" style={{ fontSize: '0.78rem' }}>الوصف (اختياري)</label>
                  <input className="form-control" value={newSvcDesc} onChange={e => setNewSvcDesc(e.target.value)}
                    placeholder="وصف مختصر للخدمة" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.65rem' }}>
                <button className="btn btn-primary btn-sm" onClick={handleAddService} disabled={!newSvcLabel.trim()}>إضافة</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAddingSvc(false); setNewSvcLabel(''); setNewSvcDesc(''); }}>إلغاء</button>
              </div>
            </div>
          )}

          {services.length === 0 && !addingSvc ? (
            <div style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--text-3)', fontSize: '0.82rem', border: '1px dashed var(--border)', borderRadius: 8 }}>
              لا توجد خدمات — أضف خدمة لتفعيل هذه الإدارة في واجهة خدمة العملاء
            </div>
          ) : (
            services.map(svc => (
              <ServiceRow
                key={svc.id}
                deptId={dept.id}
                service={svc}
                t={t}
                onUpdated={handleSvcUpdated}
                onDeleted={handleSvcDeleted}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Departments tab ────────────────────────────────────────────
function DepartmentsTab({ t }) {
  const [depts,    setDepts]    = useState([]);
  const [userMap,  setUserMap]  = useState({});
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
          <p className="text-sm text-muted" style={{ margin: '0.15rem 0 0' }}>
            كل إدارة تحتوي على خدمات، وكل خدمة تحتوي على حقول خاصة بها
          </p>
        </div>
        <button className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          onClick={() => setAdding(p => !p)}>
          <Plus size={14} strokeWidth={2.5} />{t.addDept}
        </button>
      </div>

      <Flash msg={err} />

      {adding && (
        <div style={{ border: '1px solid var(--primary)', borderRadius: 10, padding: '1rem', marginBottom: '0.75rem', background: 'var(--primary-light)' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label" style={{ fontSize: '0.82rem' }}>{t.deptLabel} *</label>
              <input className="form-control" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="مثال: قسم الشؤون القانونية" autoFocus
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

// ── AD Auto-Roles tab ──────────────────────────────────────────
function AutoRolesTab({ t }) {
  const [map,      setMap]   = useState({});
  const [newGroup, setNG]    = useState('');
  const [newRole,  setNR]    = useState('STAFF');
  const [editingG, setEG]    = useState(null);
  const [editRole, setER]    = useState('STAFF');
  const [err,      setErr]   = useState('');
  const [confirm, confirmDialog] = useConfirm();

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
    if (!await confirm(t.confirmDel)) return;
    try { const { roleGroupMap } = await api.deleteRoleEntry(group); setMap(roleGroupMap); }
    catch (e) { setErr(e.message); }
  }

  const entries = Object.entries(map);

  return (
    <div>
      {confirmDialog}
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

// ── Backup tab ─────────────────────────────────────────────────
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

// ── Templates tab ──────────────────────────────────────────────
const blankTpl = { name: '', type: 'incoming', priority: 'normal', source_entity: '', delivery_method: '', expected_days: '', note: '' };

function TemplatesTab({ t }) {
  const [templates, setTemplates] = useState([]);
  const [adding,    setAdding]    = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form,      setForm]      = useState({ ...blankTpl });
  const [msg,       setMsg]       = useState({ text: '', type: 'success' });
  const [loading,   setLoading]   = useState(true);
  const [confirm, confirmDialog] = useConfirm();

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await getTemplates(); setTemplates(r.templates || []); }
    catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(text, type = 'success') {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: 'success' }), 3000);
  }

  function startAdd() { setForm({ ...blankTpl }); setEditingId(null); setAdding(true); }
  function startEdit(tpl) {
    setForm({ name: tpl.name, type: tpl.type || 'incoming', priority: tpl.priority || 'normal',
      source_entity: tpl.source_entity || '', delivery_method: tpl.delivery_method || '',
      expected_days: tpl.expected_days ?? '', note: tpl.note || '' });
    setEditingId(tpl.id); setAdding(true);
  }
  function cancel() { setAdding(false); setEditingId(null); }

  async function handleSave() {
    if (!form.name.trim()) return;
    const body = { ...form, expected_days: form.expected_days ? Number(form.expected_days) : null };
    try {
      if (editingId) {
        const { template } = await updateTemplate(editingId, body);
        setTemplates(p => p.map(x => x.id === editingId ? template : x));
      } else {
        const { template } = await createTemplate(body);
        setTemplates(p => [...p, template]);
      }
      flash(t.templateSaved); cancel();
    } catch (e) { flash(e.message, 'error'); }
  }

  async function handleDelete(id) {
    if (!await confirm(t.confirmDel)) return;
    try {
      await deleteTemplate(id);
      setTemplates(p => p.filter(x => x.id !== id));
      flash(t.templateDeleted);
    } catch (e) { flash(e.message, 'error'); }
  }

  return (
    <div>
      {confirmDialog}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t.templates}</h3>
          <p className="text-sm text-muted" style={{ margin: '0.15rem 0 0' }}>{t.templatesNote}</p>
        </div>
        {!adding && (
          <button className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={startAdd}>
            <Plus size={14} strokeWidth={2.5} />{t.addTemplate}
          </button>
        )}
      </div>

      <Flash msg={msg.text} type={msg.type} />

      {adding && (
        <div style={{ border: '1px solid var(--primary)', borderRadius: 10, padding: '1.1rem', marginBottom: '1rem', background: 'var(--primary-light)' }}>
          <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.9rem', fontWeight: 700 }}>
            {editingId ? t.editTemplate : t.addTemplate}
          </h4>
          <div className="form-grid">
            <div className="form-group full-width">
              <label className="form-label">{t.templateName} <span className="req">*</span></label>
              <input className="form-control" value={form.name} onChange={e => setF('name', e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">{t.taskType}</label>
              <select className="form-control" value={form.type} onChange={e => setF('type', e.target.value)}>
                <option value="incoming">{t.types?.incoming}</option>
                <option value="outgoing">{t.types?.outgoing}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t.taskPriority}</label>
              <select className="form-control" value={form.priority} onChange={e => setF('priority', e.target.value)}>
                {['low','normal','high','urgent'].map(p => (
                  <option key={p} value={p}>{t.priorities?.[p] || p}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t.taskSource}</label>
              <input className="form-control" value={form.source_entity} onChange={e => setF('source_entity', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t.taskDelivery}</label>
              <select className="form-control" value={form.delivery_method} onChange={e => setF('delivery_method', e.target.value)}>
                <option value="">—</option>
                <option value="يدوي">يدوي</option>
                <option value="بريد">بريد</option>
                <option value="إيميل">إيميل</option>
                <option value="فاكس">فاكس</option>
                <option value="أخرى">أخرى</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t.expectedDays}</label>
              <input className="form-control" type="number" min="1" value={form.expected_days}
                onChange={e => setF('expected_days', e.target.value)} placeholder="e.g. 3" dir="ltr" />
            </div>
            <div className="form-group full-width">
              <label className="form-label">{t.taskNote}</label>
              <textarea className="form-control" rows={2} value={form.note} onChange={e => setF('note', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!form.name.trim()}>{t.save}</button>
            <button className="btn btn-ghost btn-sm" onClick={cancel}>{t.cancel}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="page-loading" style={{ height: 120 }}><span className="spinner" /></div>
      ) : templates.length === 0 ? (
        <div className="empty-state" style={{ padding: '2.5rem' }}>
          <div className="empty-icon"><LayoutTemplate size={28} strokeWidth={1.4} /></div>
          <div className="empty-sub">{t.noTemplates}</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t.templateName}</th><th>{t.taskType}</th><th>{t.taskPriority}</th>
                <th>{t.expectedDays}</th><th>{t.taskNote}</th><th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(tpl => (
                <tr key={tpl.id}>
                  <td style={{ fontWeight: 600 }}>{tpl.name}</td>
                  <td>
                    <span style={{ background: 'var(--accent-light)', color: 'var(--accent-hover)', padding: '1px 8px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 }}>
                      {t.types?.[tpl.type] || tpl.type}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{t.priorities?.[tpl.priority] || tpl.priority}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{tpl.expected_days ? `${tpl.expected_days}d` : '—'}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.82rem', color: 'var(--text-3)' }}>
                    {tpl.note || '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button className="btn btn-sm btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => startEdit(tpl)}>
                        <Edit2 size={11} strokeWidth={2} />{t.edit}
                      </button>
                      <button className="btn btn-sm btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => handleDelete(tpl.id)}>
                        <Trash2 size={11} strokeWidth={2} />{t.del}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sessions tab ───────────────────────────────────────────────
function SessionsTab({ t }) {
  const { user }    = useAuth();
  const [sessions,  setSessions]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [flash,     setFlash]     = useState({ text: '', type: 'success' });
  const [confirm, confirmDialog] = useConfirm();

  function showFlash(text, type = 'success') {
    setFlash({ text, type });
    setTimeout(() => setFlash({ text: '', type: 'success' }), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try { const { sessions: s } = await getSessions(); setSessions(s || []); }
    catch (e) { showFlash(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleForceLogout(jti) {
    if (!await confirm(`${t.forceLogout}?`, { danger: true })) return;
    try {
      await forceLogoutApi(jti);
      setSessions(p => p.filter(s => s.jti !== jti));
      showFlash(t.sessionTerminated);
    } catch (e) { showFlash(e.message, 'error'); }
  }

  function fmt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }

  return (
    <div>
      {confirmDialog}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t.activeSessions}</h3>
          <p className="text-sm text-muted" style={{ margin: '0.15rem 0 0' }}>{t.sessionsNote}</p>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={load}>
          <RefreshCw size={13} strokeWidth={2} />{t.refresh}
        </button>
      </div>
      <Flash msg={flash.text} type={flash.type} />
      {loading ? (
        <div className="page-loading" style={{ height: 120 }}><span className="spinner" /></div>
      ) : sessions.length === 0 ? (
        <div className="empty-state" style={{ padding: '2.5rem' }}>
          <div className="empty-icon"><Monitor size={28} strokeWidth={1.4} /></div>
          <div className="empty-sub">{t.noSessions}</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t.fullName || 'Name'}</th><th>{t.username}</th><th>{t.role}</th>
                <th>IP</th><th>{t.loggedInAt}</th><th>{t.expiresAt}</th><th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const isYou = s.username === user?.username;
                return (
                  <tr key={s.jti} style={{ background: isYou ? 'var(--primary-light)' : undefined }}>
                    <td style={{ fontWeight: 500 }}>
                      {s.full_name || s.username}
                      {isYou && (
                        <span style={{ marginInlineStart: '0.4rem', background: 'var(--primary)', color: '#fff', borderRadius: 99, fontSize: '0.68rem', padding: '1px 7px', fontWeight: 700 }}>
                          {t.yourSession}
                        </span>
                      )}
                    </td>
                    <td><code className="tag">{s.username}</code></td>
                    <td><RoleBadge role={s.role} t={t} /></td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontFamily: 'monospace' }}>{s.ip || '—'}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{fmt(s.created_at)}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{fmt(s.expires_at)}</td>
                    <td>
                      {!isYou && (
                        <button className="btn btn-sm btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          onClick={() => handleForceLogout(s.jti)}>
                          <LogOut size={11} strokeWidth={2} />{t.forceLogout}
                        </button>
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
  );
}

// ── Audit Log tab ──────────────────────────────────────────────
const AUDIT_ACTIONS = [
  'USER_LOGIN','USER_LOGOUT','TASK_CREATED','TASK_FORWARDED','TASK_CLOSED',
  'USER_CREATED','USER_UPDATED','USER_DELETED','LDAP_ROLE_ASSIGNED','SESSION_TERMINATED',
];
const PAGE_SIZE = 25;

function AuditLogTab({ t }) {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [actor,   setActor]   = useState('');
  const [action,  setAction]  = useState('');
  const [page,    setPage]    = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (actor.trim())  params.actor  = actor.trim();
    if (action)        params.action = action;
    try {
      const { logs: rows, total: tot } = await getAuditLog(params);
      setLogs(rows || []); setTotal(tot || 0);
    } catch (_) {}
    finally { setLoading(false); }
  }, [actor, action, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [actor, action]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t.auditLog}</h3>
          <p className="text-sm text-muted" style={{ margin: '0.15rem 0 0' }}>{total} {t.auditLog?.toLowerCase()}</p>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={load}>
          <RefreshCw size={13} strokeWidth={2} />{t.refresh}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={14} strokeWidth={1.8} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <input className="form-control" style={{ minWidth: 180, padding: '0.38rem 0.7rem', fontSize: '0.85rem' }}
          placeholder={t.auditFilter} value={actor} onChange={e => setActor(e.target.value)} />
        <select className="form-control" style={{ width: 'auto', padding: '0.38rem 0.7rem', fontSize: '0.85rem' }}
          value={action} onChange={e => setAction(e.target.value)}>
          <option value="">— {t.auditAction} —</option>
          {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{t.auditActions?.[a] || a}</option>)}
        </select>
        {(actor || action) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setActor(''); setAction(''); }}>✕ {t.clearSelection || 'Clear'}</button>
        )}
      </div>
      {loading ? (
        <div className="page-loading" style={{ height: 120 }}><span className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state" style={{ padding: '2.5rem' }}>
          <div className="empty-icon"><Activity size={28} strokeWidth={1.4} /></div>
          <div className="empty-sub">{t.noAuditLogs}</div>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t.auditActor}</th><th>{t.role}</th><th>{t.auditAction}</th>
                  <th>{t.auditTarget}</th><th>{t.auditTime}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(row => (
                  <tr key={row.id}>
                    <td><span style={{ fontWeight: 600 }}>{row.actor_username}</span></td>
                    <td>{row.actor_role ? <RoleBadge role={row.actor_role} t={t} /> : <span className="text-muted">—</span>}</td>
                    <td>
                      <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 8px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {t.auditActions?.[row.action] || row.action}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.target_id || '—'}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
              <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                <ChevronLeft size={14} strokeWidth={2} />
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{page + 1} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────
export default function SuperAdminPanel() {
  const { t } = useLang();
  const [tab, setTab] = useState('departments');

  const tabs = [
    { id: 'departments', icon: <Building2      size={15} strokeWidth={1.8} />, label: t.deptFields },
    { id: 'autoroles',   icon: <Key            size={15} strokeWidth={1.8} />, label: t.roleMaps },
    { id: 'templates',   icon: <LayoutTemplate size={15} strokeWidth={1.8} />, label: t.templates },
    { id: 'sessions',    icon: <Monitor        size={15} strokeWidth={1.8} />, label: t.activeSessions },
    { id: 'audit',       icon: <Activity       size={15} strokeWidth={1.8} />, label: t.auditLog },
    { id: 'backup',      icon: <HardDrive      size={15} strokeWidth={1.8} />, label: t.config },
  ];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary)' }}>{t.adminPanel}</h2>
        <p className="text-sm text-muted" style={{ marginTop: '0.2rem' }}>
          {t.deptFields} · {t.roleMaps} · {t.templates} · {t.activeSessions} · {t.auditLog} · {t.config}
        </p>
      </div>

      <div className="card">
        <div style={{ padding: '0 1.5rem', overflowX: 'auto' }}>
          <div className="admin-tabs" style={{ minWidth: 'max-content' }}>
            {tabs.map(tb => (
              <button key={tb.id}
                className={`admin-tab${tab === tb.id ? ' active' : ''}`}
                onClick={() => setTab(tb.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                {tb.icon}{tb.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {tab === 'departments' && <DepartmentsTab t={t} />}
          {tab === 'autoroles'   && <AutoRolesTab  t={t} />}
          {tab === 'templates'   && <TemplatesTab  t={t} />}
          {tab === 'sessions'    && <SessionsTab   t={t} />}
          {tab === 'audit'       && <AuditLogTab   t={t} />}
          {tab === 'backup'      && <BackupTab     t={t} />}
        </div>
      </div>
    </div>
  );
}
