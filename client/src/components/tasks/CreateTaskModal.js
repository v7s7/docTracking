import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { createTask } from '../../services/taskService';
import { getTemplates } from '../../services/templateService';
import { getDepartments } from '../../services/deptService';
import {
  X, AlertTriangle, LayoutTemplate, ChevronDown, ClipboardList,
  ChevronRight, Search, Building2, User, Briefcase, HelpCircle, ArrowRight,
} from 'lucide-react';

// ── Sender type icons ─────────────────────────────────────────
const SENDER_TYPES = [
  { value: 'شخص',  icon: <User      size={16} strokeWidth={2} />, label: 'شخص' },
  { value: 'شركة', icon: <Briefcase size={16} strokeWidth={2} />, label: 'شركة' },
  { value: 'أخرى', icon: <HelpCircle size={16} strokeWidth={2} />, label: 'أخرى' },
];

// ── Generic form defaults (SUPER_ADMIN / ADMIN uses generic form) ─────────
const blankGeneric = {
  title: '', type: 'incoming', priority: 'normal',
  source_entity: '', delivery_method: '', expected_at: '', note: '',
};

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Dynamic field renderer ────────────────────────────────────
function DeptField({ field, value, onChange }) {
  const { key, label, type, placeholder, options } = field;

  if (type === 'checkbox') {
    return (
      <div className="form-group full-width" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
        <input
          type="checkbox" id={`df_${key}`} checked={!!value}
          onChange={e => onChange(e.target.checked)}
          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        <label htmlFor={`df_${key}`} style={{ fontWeight: 500, cursor: 'pointer', margin: 0, fontSize: '0.9rem' }}>
          {label}
        </label>
      </div>
    );
  }
  if (type === 'textarea') {
    return (
      <div className="form-group full-width">
        <label className="form-label">{label} {field.required && <span className="req">*</span>}</label>
        <textarea className="form-control" rows={3} value={value}
          onChange={e => onChange(e.target.value)} placeholder={placeholder || ''} />
      </div>
    );
  }
  if (type === 'select') {
    return (
      <div className="form-group">
        <label className="form-label">{label} {field.required && <span className="req">*</span>}</label>
        <select className="form-control" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">— اختر —</option>
          {(options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }
  if (type === 'date') {
    return (
      <div className="form-group">
        <label className="form-label">{label} {field.required && <span className="req">*</span>}</label>
        <input className="form-control" type="date" value={value}
          onChange={e => onChange(e.target.value)} dir="ltr" />
      </div>
    );
  }
  return (
    <div className="form-group">
      <label className="form-label">{label} {field.required && <span className="req">*</span>}</label>
      <input className="form-control" type="text"
        inputMode={type === 'number' ? 'decimal' : 'text'}
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''} />
    </div>
  );
}

// ── CS multi-step wizard ──────────────────────────────────────
function CSWizard({ departments, onClose, onCreated }) {
  const { user } = useAuth();

  // Step: 'sender' | 'select' | 'fields'
  const [step,         setStep]        = useState('sender');
  const [senderType,   setSenderType]  = useState('شخص');
  const [senderName,   setSenderName]  = useState('');
  const [senderPhone,  setSenderPhone] = useState('');

  // Department + service selection
  const [selectedDept,    setSelectedDept]    = useState(null);
  const [selectedService, setSelectedService] = useState(null);

  // Search
  const [query,       setQuery]       = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // Dynamic field values
  const [extra, setExtra] = useState({});
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');

  const setEx = (k, v) => setExtra(p => ({ ...p, [k]: v }));

  // Flatten all services for search
  const allServices = useMemo(() => {
    const list = [];
    departments.forEach(dept => {
      (dept.services || []).forEach(svc => list.push({ dept, service: svc }));
    });
    return list;
  }, [departments]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allServices.filter(({ dept, service }) =>
      service.label.toLowerCase().includes(q) ||
      dept.label.toLowerCase().includes(q) ||
      (service.description || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query, allServices]);

  function initExtra(svc) {
    const init = {};
    (svc.fields || []).forEach(f => { init[f.key] = f.type === 'checkbox' ? false : ''; });
    setExtra(init);
  }

  function pickService(dept, service) {
    setSelectedDept(dept);
    setSelectedService(service);
    initExtra(service);
    setQuery('');
    setShowDropdown(false);
    setStep('fields');
    setErr('');
  }

  function pickDept(dept) {
    const services = dept.services || [];
    if (services.length === 1) {
      pickService(dept, services[0]);
    } else {
      setSelectedDept(dept);
      setSelectedService(null);
      setStep('select');
      setErr('');
    }
  }

  function backToSelect() {
    setSelectedService(null);
    setStep('select');
    setErr('');
  }

  function backToDepts() {
    setSelectedDept(null);
    setSelectedService(null);
    setStep('select');
    setErr('');
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function isSenderValid() {
    return senderName.trim().length > 0;
  }

  function isFieldsValid() {
    if (!selectedService) return false;
    return (selectedService.fields || []).every(f => {
      if (!f.required) return true;
      const val = extra[f.key];
      if (f.type === 'checkbox') return val === true;
      return val !== undefined && String(val).trim() !== '';
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedDept || !selectedService) return;
    setBusy(true); setErr('');
    try {
      const payload = {
        title:         `${selectedDept.label} – ${selectedService.label}`,
        type:          'incoming',
        priority:      'normal',
        source_entity: `${senderType}: ${senderName}${senderPhone ? ' · ' + senderPhone : ''}`,
        extra_data: {
          _form_id:      selectedService.id,
          _dept_id:      selectedDept.id,
          _sender_type:  senderType,
          _sender_name:  senderName,
          _sender_phone: senderPhone,
          ...extra,
        },
        target_dept_id: selectedDept.id,
      };
      const res = await createTask(payload);
      onCreated?.(res.task);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ── Breadcrumb ────────────────────────────────────────────
  const breadcrumb = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: '1rem', flexWrap: 'wrap' }}>
      <span
        style={{ color: step === 'sender' ? 'var(--accent-hover)' : 'var(--text-2)', fontWeight: step === 'sender' ? 700 : 400, cursor: step !== 'sender' ? 'pointer' : 'default' }}
        onClick={() => step !== 'sender' && setStep('sender')}
      >معلومات المُراجع</span>
      <ChevronRight size={12} strokeWidth={2} />
      <span
        style={{ color: (step === 'select' || step === 'fields') ? 'var(--accent-hover)' : 'var(--text-3)', fontWeight: (step === 'select') ? 700 : 400, cursor: isSenderValid() && step !== 'select' && step !== 'sender' ? 'pointer' : 'default' }}
        onClick={() => isSenderValid() && step === 'fields' && backToDepts()}
      >{selectedDept ? selectedDept.label : 'اختر الإدارة'}</span>
      {selectedService && (
        <>
          <ChevronRight size={12} strokeWidth={2} />
          <span style={{ color: 'var(--accent-hover)', fontWeight: 700 }}>{selectedService.label}</span>
        </>
      )}
    </div>
  );

  // ── Search bar (shown in select + fields steps) ─────────
  const searchBar = (
    <div ref={searchRef} style={{ position: 'relative', marginBottom: '1.1rem' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} strokeWidth={2} style={{ position: 'absolute', insetInlineStart: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
        <input
          className="form-control"
          style={{ paddingInlineStart: '2.1rem', fontSize: '0.88rem' }}
          placeholder="ابحث عن خدمة أو إدارة..."
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => query && setShowDropdown(true)}
          autoFocus={step === 'select'}
        />
      </div>
      {showDropdown && searchResults.length > 0 && (
        <div style={{
          position: 'absolute', top: '110%', insetInlineStart: 0, insetInlineEnd: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 60, overflow: 'hidden',
        }}>
          {searchResults.map(({ dept, service }) => (
            <button
              key={service.id}
              type="button"
              onClick={() => pickService(dept, service)}
              style={{
                width: '100%', textAlign: 'start', padding: '0.65rem 1rem',
                background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <ClipboardList size={14} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{service.label}</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-3)' }}>{dept.label}</div>
              </div>
              <ChevronRight size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        {breadcrumb}

        {/* ── Step: sender info ─────────────────────── */}
        {step === 'sender' && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: '1.1rem' }}>
              أدخل معلومات الجهة أو الشخص المُراجع
            </p>

            {/* Sender type toggle */}
            <div className="form-group full-width">
              <label className="form-label">الجهة المرسلة <span className="req">*</span></label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {SENDER_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setSenderType(t.value)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.45rem 1rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                      fontSize: '0.88rem', border: '1.5px solid',
                      borderColor: senderType === t.value ? 'var(--accent)' : 'var(--border)',
                      background: senderType === t.value ? 'var(--accent-light)' : 'var(--surface)',
                      color: senderType === t.value ? 'var(--accent-hover)' : 'var(--text-2)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">
                  {senderType === 'شركة' ? 'اسم الشركة / الجهة' : 'الاسم الكامل'} <span className="req">*</span>
                </label>
                <input
                  className="form-control"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder={senderType === 'شركة' ? 'اسم الشركة أو الجهة' : 'الاسم الكامل'}
                  autoFocus
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">رقم الهاتف</label>
                <input
                  className="form-control"
                  value={senderPhone}
                  onChange={e => setSenderPhone(e.target.value)}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                  inputMode="tel"
                />
              </div>
            </div>

            {err && (
              <div className="alert alert-error" style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Step: department + service selection ─── */}
        {step === 'select' && (
          <div>
            {searchBar}

            {!selectedDept ? (
              <>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: '0.85rem' }}>
                  اختر الإدارة المعنية بالمعاملة
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.65rem' }}>
                  {departments.map(dept => (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => pickDept(dept)}
                      style={{
                        textAlign: 'start', padding: '0.85rem 1rem',
                        background: 'var(--surface)', border: '1.5px solid var(--border)',
                        borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                        display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                    >
                      <Building2 size={18} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.15rem' }}>{dept.label}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                          {(dept.services || []).length} خدمة
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  <button type="button" onClick={backToDepts}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: 0, fontWeight: 600 }}>
                    <ChevronRight size={14} strokeWidth={2.5} style={{ transform: 'rotate(180deg)' }} /> الإدارات
                  </button>
                  <ChevronRight size={12} style={{ color: 'var(--text-3)' }} />
                  <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>{selectedDept.label}</span>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: '0.85rem' }}>
                  اختر نوع الخدمة
                </p>
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  {(selectedDept.services || []).map(svc => (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => pickService(selectedDept, svc)}
                      style={{
                        width: '100%', textAlign: 'start', padding: '0.9rem 1rem',
                        background: 'var(--surface)', border: '1.5px solid var(--border)',
                        borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                    >
                      <ClipboardList size={18} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.15rem' }}>{svc.label}</div>
                        {svc.description && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{svc.description}</div>
                        )}
                      </div>
                      <ChevronRight size={15} strokeWidth={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    </button>
                  ))}
                  {(selectedDept.services || []).length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                      لا توجد خدمات مضافة لهذه الإدارة
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step: dynamic service fields ─────────── */}
        {step === 'fields' && selectedService && (
          <div>
            {/* Sender summary banner */}
            <div style={{
              marginBottom: '1.1rem', padding: '0.6rem 0.9rem',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.6rem',
              fontSize: '0.82rem', flexWrap: 'wrap',
            }}>
              <span style={{ color: 'var(--text-3)' }}>المُراجع:</span>
              <strong>{senderType}</strong>
              <span>·</span>
              <strong>{senderName}</strong>
              {senderPhone && <><span>·</span><span dir="ltr">{senderPhone}</span></>}
              <button type="button" onClick={() => setStep('sender')}
                style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600 }}>
                تعديل
              </button>
            </div>

            {/* Service banner */}
            <div style={{
              marginBottom: '1.1rem', padding: '0.65rem 0.9rem',
              background: 'var(--accent-light)', border: '1px solid var(--accent)',
              borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
            }}>
              <ClipboardList size={14} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: '0.82rem', color: 'var(--accent-hover)', fontWeight: 700 }}>
                  {selectedDept.label} — {selectedService.label}
                </div>
                {selectedService.description && (
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
                    {selectedService.description}
                  </div>
                )}
              </div>
              <button type="button" onClick={backToSelect}
                style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, flexShrink: 0 }}>
                تغيير
              </button>
            </div>

            {err && (
              <div className="alert alert-error" style={{ marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
              </div>
            )}

            {(selectedService.fields || []).length > 0 ? (
              <div className="form-grid">
                {selectedService.fields.map(field => (
                  <DeptField
                    key={field.key}
                    field={field}
                    value={extra[field.key] ?? (field.type === 'checkbox' ? false : '')}
                    onChange={v => setEx(field.key, v)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                لا توجد حقول لهذه الخدمة — سيتم إنشاء المعاملة مباشرة
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────── */}
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>إلغاء</button>

        {step === 'sender' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            disabled={!isSenderValid()}
            onClick={() => { if (isSenderValid()) setStep('select'); }}
          >
            التالي <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        )}

        {step === 'select' && (
          <button type="button" className="btn btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => setStep('sender')}>
            <ChevronRight size={14} strokeWidth={2.5} style={{ transform: 'rotate(180deg)' }} /> رجوع
          </button>
        )}

        {step === 'fields' && (
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !isFieldsValid()}
          >
            {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
            إنشاء المعاملة
          </button>
        )}
      </div>
    </form>
  );
}

// ── Staff dept form (unchanged logic, updated for new structure) ──────────
function StaffForm({ departments, user, onClose, onCreated }) {
  const { t } = useLang();

  const [availableForms, setAvailableForms] = useState([]);
  const [selectedForm,   setSelectedForm]   = useState(null);
  const [extra,          setExtra]          = useState({});
  const [showPicker,     setShowPicker]     = useState(false);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const setEx = (k, v) => setExtra(p => ({ ...p, [k]: v }));

  function initExtra(svc) {
    const init = {};
    (svc.fields || []).forEach(f => { init[f.key] = f.type === 'checkbox' ? false : ''; });
    setExtra(init);
  }

  useEffect(() => {
    if (!departments.length || !user?.dept_id) return;

    // Find the department matching this staff member's group
    const dept = departments.find(d => d.ldapGroup === user.dept_id || d.id === user.dept_id);
    if (!dept) return;

    const services = dept.services || [];
    if (services.length === 0) return;
    if (services.length === 1) {
      setSelectedForm({ dept, service: services[0] });
      initExtra(services[0]);
    } else {
      setAvailableForms(services.map(s => ({ dept, service: s })));
      setShowPicker(true);
    }
  }, [departments, user?.dept_id]);

  function pickForm(item) {
    setSelectedForm(item);
    initExtra(item.service);
    setShowPicker(false);
    setErr('');
  }

  function isValid() {
    if (!selectedForm) return false;
    return (selectedForm.service.fields || []).every(f => {
      if (!f.required) return true;
      const val = extra[f.key];
      if (f.type === 'checkbox') return val === true;
      return val !== undefined && String(val).trim() !== '';
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedForm) return;
    setBusy(true); setErr('');
    try {
      const payload = {
        title:      `${selectedForm.dept.label} – ${selectedForm.service.label}`,
        type:       'incoming',
        priority:   'normal',
        extra_data: {
          _form_id: selectedForm.service.id,
          _dept_id: selectedForm.dept.id,
          ...extra,
        },
      };
      const res = await createTask(payload);
      onCreated?.(res.task);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (showPicker) {
    return (
      <>
        <div className="modal-body">
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.88rem' }}>
            سيتم إرسال النموذج تلقائياً إلى خدمة العملاء
          </p>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {availableForms.map(item => (
              <button
                key={item.service.id}
                type="button"
                onClick={() => pickForm(item)}
                style={{
                  width: '100%', textAlign: 'start', padding: '1rem 1.1rem',
                  background: 'var(--surface)', border: '1.5px solid var(--border)',
                  borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
              >
                <ClipboardList size={20} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.2rem' }}>{item.service.label}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>{item.service.description || ''}</div>
                </div>
                <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--text-3)', marginInlineStart: 'auto', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
        </div>
      </>
    );
  }

  if (selectedForm) {
    return (
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div style={{
            marginBottom: '1.25rem', padding: '0.7rem 1rem',
            background: 'var(--accent-light)', border: '1px solid var(--accent)',
            borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          }}>
            <ClipboardList size={15} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--accent-hover)', fontWeight: 600, marginBottom: '0.15rem' }}>
                {selectedForm.service.description || selectedForm.service.label}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                سيتم إرسال هذا النموذج تلقائياً إلى خدمة العملاء · جميع الحقول الإلزامية مُعلّمة بـ *
              </div>
            </div>
          </div>

          {availableForms.length > 1 && (
            <button type="button"
              style={{ marginBottom: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              onClick={() => { setSelectedForm(null); setShowPicker(true); }}>
              <ChevronRight size={13} strokeWidth={2.5} style={{ transform: 'rotate(180deg)' }} /> تغيير النوع
            </button>
          )}

          {err && (
            <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={14} strokeWidth={2} /><span>{err}</span>
            </div>
          )}

          <div className="form-grid">
            {(selectedForm.service.fields || []).map(field => (
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
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !isValid()}>
            {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
            {t.createTask}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="modal-body">
      <div className="page-loading" style={{ height: 120 }}><span className="spinner" /></div>
    </div>
  );
}

// ── Generic form (SUPER_ADMIN / ADMIN) ────────────────────────
function GenericForm({ onClose, onCreated }) {
  const { t } = useLang();
  const [form,      setForm]      = useState({ ...blankGeneric });
  const [templates, setTemplates] = useState([]);
  const [tplOpen,   setTplOpen]   = useState(false);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {});
  }, []);

  function applyTemplate(tpl) {
    setForm({
      title: '', type: tpl.type || 'incoming', priority: tpl.priority || 'normal',
      source_entity: tpl.source_entity || '', delivery_method: tpl.delivery_method || '',
      expected_at: tpl.expected_days ? addDays(tpl.expected_days) : '',
      note: tpl.note || '',
    });
    setTplOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await createTask({ ...form });
      onCreated?.(res.task);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
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
              <option value="يدوي">يدوي</option>
              <option value="بريد">بريد</option>
              <option value="إيميل">إيميل</option>
              <option value="فاكس">فاكس</option>
              <option value="أخرى">أخرى</option>
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
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.title.trim()}>
          {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
          {t.createTask}
        </button>
      </div>
    </form>
  );
}

// ── Main modal ────────────────────────────────────────────────
export default function CreateTaskModal({ onClose, onCreated }) {
  const { t }    = useLang();
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    getDepartments()
      .then(depts => setDepartments(depts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isCS         = user?.role === 'CUSTOMER_SERVICE';
  const isGeneric    = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);
  const isStaff      = ['STAFF', 'MANAGER'].includes(user?.role);

  const modalTitle = isCS ? 'إنشاء معاملة جديدة' : t.createTask;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">{modalTitle}</h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        {loading ? (
          <div className="modal-body">
            <div className="page-loading" style={{ height: 120 }}><span className="spinner" /></div>
          </div>
        ) : isCS ? (
          <CSWizard departments={departments} onClose={onClose} onCreated={onCreated} />
        ) : isStaff ? (
          <StaffForm departments={departments} user={user} onClose={onClose} onCreated={onCreated} />
        ) : (
          <GenericForm onClose={onClose} onCreated={onCreated} />
        )}
      </div>
    </div>
  );
}
