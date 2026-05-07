import React, { useState } from 'react';
import { useLang } from '../../context/LangContext';
import { createTask } from '../../services/taskService';

export default function CreateTaskModal({ onClose, onCreated }) {
  const { t } = useLang();
  const [form, setForm] = useState({
    title: '', type: 'incoming', priority: 'normal',
    source_entity: '', delivery_method: '', expected_at: '', note: '',
  });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
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
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}><span>⚠</span><span>{err}</span></div>}

            <div className="form-grid">
              <div className="form-group full-width">
                <label className="form-label">{t.taskTitle} <span className="req">*</span></label>
                <input className="form-control" value={form.title} onChange={e => set('title', e.target.value)} required />
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
                  <option value="email">{t.lang === 'ar' ? 'إيميل' : 'Email'}</option>
                  <option value="manual">{t.lang === 'ar' ? 'يدوي' : 'Manual'}</option>
                  <option value="mail">{t.lang === 'ar' ? 'بريد' : 'Mail'}</option>
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
              {busy ? <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> : null}
              {t.createTask}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
