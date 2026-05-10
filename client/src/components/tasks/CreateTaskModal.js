import React, { useState, useEffect } from 'react';
import { useLang } from '../../context/LangContext';
import { createTask } from '../../services/taskService';
import { getTemplates } from '../../services/templateService';
import { X, AlertTriangle, LayoutTemplate, ChevronDown } from 'lucide-react';

const blank = {
  title: '', type: 'incoming', priority: 'normal',
  source_entity: '', delivery_method: '', expected_at: '', note: '',
};

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function CreateTaskModal({ onClose, onCreated }) {
  const { t }  = useLang();
  const [form,      setForm]      = useState({ ...blank });
  const [templates, setTemplates] = useState([]);
  const [tplOpen,   setTplOpen]   = useState(false);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {});
  }, []);

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

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await createTask(form);
      onCreated?.(res.task);
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">{t.createTask}</h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Template picker */}
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
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.title.trim()}>
              {busy && <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />}
              {t.createTask}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
