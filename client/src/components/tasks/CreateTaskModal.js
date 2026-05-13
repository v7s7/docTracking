import React, { useState, useEffect } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { createTask } from '../../services/taskService';
import { getTemplates } from '../../services/templateService';
import { getDepartments } from '../../services/deptService';
import { X, AlertTriangle, LayoutTemplate, ChevronDown, ClipboardList, ChevronRight } from 'lucide-react';

const blank = {
  title: '', type: 'incoming', priority: 'normal',
  source_entity: '', delivery_method: '', expected_at: '', note: '',
};

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Short description shown in form banner and form-picker cards
const DEPT_DESC = {
  accounts_checks:          'تسليم الشيكات للمستحقين من الأفراد والشركات والجهات ذات العلاقة',
  cs_correspondence:        'تسجيل وتتبع المراسلات الرسمية الواردة والصادرة',
  cs_inquiries:             'تسجيل الاستفسارات العامة الواردة من المراجعين',
  banks_social_research:    'إجراء البحوث الاجتماعية للأسر المتعففة',
  banks_student_contracts:  'توقيع عقود الطلبة الجامعيين',
  asset_development_leases: 'تسجيل عقود الإيجار لتنمية الأصول الوقفية',
};

// Extract a short form name (everything after the dash)
function shortLabel(label) {
  const parts = label.split('–');
  return parts.length > 1 ? parts.slice(1).join('–').trim() : label;
}

function DeptField({ field, value, onChange }) {
  const { key, label, type, placeholder, options } = field;

  if (type === 'checkbox') {
    return (
      <div className="form-group full-width" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
        <input
          type="checkbox"
          id={`df_${key}`}
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        <label htmlFor={`df_${key}`} style={{ fontWeight: 500, cursor: 'pointer', margin: 0, fontSize: '0.9rem' }}>
          {label} <span className="req">*</span>
        </label>
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <div className="form-group full-width">
        <label className="form-label">{label} <span className="req">*</span></label>
        <textarea
          className="form-control"
          rows={3}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ''}
          required
        />
      </div>
    );
  }

  if (type === 'select') {
    return (
      <div className="form-group">
        <label className="form-label">{label} <span className="req">*</span></label>
        <select className="form-control" value={value} onChange={e => onChange(e.target.value)} required>
          <option value="">— اختر —</option>
          {(options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }

  if (type === 'date') {
    return (
      <div className="form-group">
        <label className="form-label">{label} <span className="req">*</span></label>
        <input
          className="form-control"
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          dir="ltr"
          required
        />
      </div>
    );
  }

  // text / number
  return (
    <div className="form-group">
      <label className="form-label">{label} <span className="req">*</span></label>
      <input
        className="form-control"
        type="text"
        inputMode={type === 'number' ? 'decimal' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
        required
      />
    </div>
  );
}

export default function CreateTaskModal({ onClose, onCreated }) {
  const { t }    = useLang();
  const { user } = useAuth();

  // Generic form state
  const [form,      setForm]      = useState({ ...blank });
  const [templates, setTemplates] = useState([]);
  const [tplOpen,   setTplOpen]   = useState(false);

  // Dept form state
  const [availableForms, setAvailableForms] = useState([]); // forms for this dept group
  const [selectedForm,   setSelectedForm]   = useState(null); // the chosen dept config
  const [extra,          setExtra]          = useState({});    // dept field values
  const [showPicker,     setShowPicker]     = useState(false); // multi-form selector step

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const set   = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setEx = (k, v) => setExtra(p => ({ ...p, [k]: v }));

  function initExtra(dc) {
    const init = {};
    dc.fields.forEach(f => { init[f.key] = f.type === 'checkbox' ? false : ''; });
    setExtra(init);
  }

  useEffect(() => {
    getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {});

    if (!user?.dept_id) return;

    getDepartments()
      .then(depts => {
        // Find direct match by id first, then fall back to ldapGroup lookup
        const directMatch = depts.find(d => d.id === user.dept_id);
        const ldapGroup   = directMatch ? directMatch.ldapGroup : user.dept_id;

        // All forms that belong to the same ldapGroup
        const forms = depts.filter(d => d.ldapGroup === ldapGroup);

        if (forms.length === 0) return;

        if (forms.length === 1) {
          // Single form — show directly
          setSelectedForm(forms[0]);
          initExtra(forms[0]);
        } else {
          // Multiple forms — show picker first
          setAvailableForms(forms);
          setShowPicker(true);
        }
      })
      .catch(() => {});
  }, [user?.dept_id]);

  function pickForm(dc) {
    setSelectedForm(dc);
    initExtra(dc);
    setShowPicker(false);
    setErr('');
  }

  function applyTemplate(tpl) {
    setForm({
      title:           '',
      type:            tpl.type            || 'incoming',
      priority:        tpl.priority        || 'normal',
      source_entity:   tpl.source_entity   || '',
      delivery_method: tpl.delivery_method || '',
      expected_at:     tpl.expected_days   ? addDays(tpl.expected_days) : '',
      note:            tpl.note            || '',
    });
    setTplOpen(false);
  }

  function isDeptFormValid() {
    if (!selectedForm) return false;
    return selectedForm.fields.every(f => {
      const val = extra[f.key];
      if (f.type === 'checkbox') return val === true;
      return val !== undefined && String(val).trim() !== '';
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      let payload;
      if (selectedForm) {
        payload = {
          title:      selectedForm.label,
          type:       'incoming',
          priority:   'normal',
          extra_data: { _form_id: selectedForm.id, ...extra },
        };
      } else {
        payload = { ...form };
      }
      const res = await createTask(payload);
      onCreated?.(res.task);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const isSubmitDisabled = busy || (selectedForm ? !isDeptFormValid() : !form.title.trim());

  // ── Modal title ─────────────────────────────────────────────
  const modalTitle = showPicker
    ? 'اختر نوع المعاملة'
    : selectedForm
      ? shortLabel(selectedForm.label)
      : t.createTask;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>

        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Back button when inside a form picked from a multi-form dept */}
            {selectedForm && availableForms.length > 1 && (
              <button
                type="button"
                onClick={() => { setSelectedForm(null); setShowPicker(true); setErr(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}
              >
                <ChevronRight size={18} strokeWidth={2} />
              </button>
            )}
            <h3 className="modal-title">{modalTitle}</h3>
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        {/* ── Form-type picker (step 1 for multi-form depts) ── */}
        {showPicker && (
          <div className="modal-body">
            <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.88rem' }}>
              سيتم إرسال النموذج تلقائياً إلى خدمة العملاء
            </p>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {availableForms.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pickForm(f)}
                  style={{
                    width: '100%',
                    textAlign: 'start',
                    padding: '1rem 1.1rem',
                    background: 'var(--surface)',
                    border: '1.5px solid var(--border)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                >
                  <ClipboardList size={20} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.2rem' }}>
                      {shortLabel(f.label)}
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>
                      {DEPT_DESC[f.id] || ''}
                    </div>
                  </div>
                  <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--text-3)', marginInlineStart: 'auto', flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Dept-specific form (step 2) ── */}
        {selectedForm && (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <div style={{
                marginBottom: '1.25rem',
                padding: '0.7rem 1rem',
                background: 'var(--accent-light)',
                border: '1px solid var(--accent)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
              }}>
                <ClipboardList size={15} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--accent-hover)', fontWeight: 600, marginBottom: '0.15rem' }}>
                    {DEPT_DESC[selectedForm.id] || selectedForm.label}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                    سيتم إرسال هذا النموذج تلقائياً إلى خدمة العملاء · جميع الحقول إلزامية
                  </div>
                </div>
              </div>

              {err && (
                <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
                </div>
              )}

              <div className="form-grid">
                {selectedForm.fields.map(field => (
                  <DeptField
                    key={field.key}
                    field={field}
                    value={extra[field.key] ?? (field.type === 'checkbox' ? false : '')}
                    onChange={v => setEx(field.key, v)}
                  />
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={isSubmitDisabled}>
                {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
                {t.createTask}
              </button>
            </div>
          </form>
        )}

        {/* ── Generic CS / admin form ── */}
        {!showPicker && !selectedForm && (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {templates.length > 0 && (
                <div style={{ marginBottom: '1.1rem', position: 'relative' }}>
                  <button type="button"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-light)', color: 'var(--accent-hover)', border: '1px solid var(--accent)', borderRadius: 8, padding: '0.38rem 0.85rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => setTplOpen(p => !p)}>
                    <LayoutTemplate size={13} strokeWidth={2} />
                    {t.useTemplate}
                    <ChevronDown size={12} strokeWidth={2} style={{ transform: tplOpen ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
                  </button>
                  {tplOpen && (
                    <div style={{ position: 'absolute', top: '110%', insetInlineStart: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 240, overflow: 'hidden' }}>
                      {templates.map(tpl => (
                        <button key={tpl.id} type="button"
                          style={{ width: '100%', textAlign: 'start', padding: '0.65rem 1rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.85rem' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          onClick={() => applyTemplate(tpl)}>
                          <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                          <div className="text-sm text-muted">
                            {t.types?.[tpl.type] || tpl.type} · {t.priorities?.[tpl.priority] || tpl.priority}
                            {tpl.expected_days ? ` · ${tpl.expected_days}d` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {err && (
                <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
                </div>
              )}

              <div className="form-grid">
                <div className="form-group full-width">
                  <label className="form-label">{t.taskTitle} <span className="req">*</span></label>
                  <input className="form-control" value={form.title} onChange={e => set('title', e.target.value)} required autoFocus />
                </div>
                <div className="form-group">
                  <label className="form-label">{t.taskType}</label>
                  <select className="form-control" value={form.type} onChange={e => set('type', e.target.value)}>
                    <option value="incoming">{t.types?.incoming}</option>
                    <option value="outgoing">{t.types?.outgoing}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t.taskPriority}</label>
                  <select className="form-control" value={form.priority} onChange={e => set('priority', e.target.value)}>
                    {['low','normal','high','urgent'].map(p => (
                      <option key={p} value={p}>{t.priorities?.[p] || p}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t.taskSource}</label>
                  <input className="form-control" value={form.source_entity} onChange={e => set('source_entity', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t.taskDelivery}</label>
                  <select className="form-control" value={form.delivery_method} onChange={e => set('delivery_method', e.target.value)}>
                    <option value="">—</option>
                    <option value="email">Email</option>
                    <option value="manual">Manual</option>
                    <option value="mail">Mail</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t.taskExpected}</label>
                  <input className="form-control" type="date" value={form.expected_at} onChange={e => set('expected_at', e.target.value)} dir="ltr" />
                </div>
                <div className="form-group full-width">
                  <label className="form-label">{t.taskNote}</label>
                  <textarea className="form-control" rows={3} value={form.note} onChange={e => set('note', e.target.value)} />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={isSubmitDisabled}>
                {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
                {t.createTask}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
