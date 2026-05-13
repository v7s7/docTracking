import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { getTask, forwardTask, returnTask, closeTask, addComment } from '../../services/taskService';
import { getDepartments } from '../../services/deptService';
import { StatusBadge, PriorityBadge } from './TaskList';
import {
  PlusCircle, ArrowRight, RotateCcw, MessageSquare, CheckCircle,
  ChevronLeft, X, Send, AlertTriangle, Clock, Inbox,
} from 'lucide-react';

const EVENT_ICONS = {
  created:   <PlusCircle    size={14} strokeWidth={1.8} />,
  forwarded: <ArrowRight    size={14} strokeWidth={1.8} />,
  returned:  <RotateCcw     size={14} strokeWidth={1.8} />,
  commented: <MessageSquare size={14} strokeWidth={1.8} />,
  closed:    <CheckCircle   size={14} strokeWidth={1.8} />,
};

function daysBetween(from, to) {
  const ms = new Date(to) - new Date(from);
  if (isNaN(ms) || ms < 0) return null;
  const d = ms / (1000 * 60 * 60 * 24);
  return d < 1 ? `${Math.round(ms / 60000)}m` : `${d.toFixed(1)}d`;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function TaskDetail({ taskId, onBack, onUpdate }) {
  const { t }        = useLang();
  const { user }     = useAuth();
  const [task, setTask]     = useState(null);
  const [depts, setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [modal, setModal]   = useState(null);
  const [note, setNote]     = useState('');
  const [toDept, setToDept] = useState('');

  const isCS  = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user?.role);

  const load = useCallback(async () => {
    try {
      const [td, dd] = await Promise.all([getTask(taskId), getDepartments()]);
      setTask(td.task);
      setDepts(dd);
    } catch (_) {}
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3500); }

  async function act(fn, successMsg) {
    setBusy(true);
    try {
      const res = await fn();
      setTask(res.task);
      setModal(null);
      setNote('');
      setToDept('');
      flash(successMsg);
      onUpdate?.();
    } catch (e) { flash(`ERR:${e.message}`); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page-loading"><span className="spinner" /></div>;
  if (!task)   return <div className="empty-state"><div className="empty-sub">Task not found.</div></div>;

  const canClose   = isCS && task.status !== 'closed';
  const canForward = isCS && task.status !== 'closed';
  const canReturn  = !isCS && task.status !== 'closed' && task.status !== 'new';
  const canComment = task.status !== 'closed';
  const hasReceivedComment = task.events?.some(
    ev => ev.type === 'commented' && (ev.note === 'Received' || ev.note === 'تم الاستلام')
  );
  const canMarkReceived = canComment && !hasReceivedComment;
  const isErr = msg.startsWith('ERR:');

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Back */}
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
        <ChevronLeft size={15} strokeWidth={2} />{t.tasks}
      </button>

      {msg && (
        <div className={`alert ${isErr ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isErr && <AlertTriangle size={15} strokeWidth={2} />}
          {isErr ? msg.replace('ERR:', '') : msg}
        </div>
      )}

      {/* Task card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <code className="tag">{task.serial}</code>
              <StatusBadge status={task.status} t={t} />
              <PriorityBadge priority={task.priority} t={t} />
            </div>
            <div className="card-title" style={{ marginTop: '0.35rem' }}>{task.title}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canForward && (
              <button className="btn btn-primary btn-sm" onClick={() => setModal('forward')} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <Send size={13} strokeWidth={2} />{t.forwardTask}
              </button>
            )}
            {canReturn && (
              <button className="btn btn-secondary btn-sm" onClick={() => setModal('return')} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <RotateCcw size={13} strokeWidth={2} />{t.returnToCS}
              </button>
            )}
            {canClose && (
              <button className="btn btn-danger btn-sm" onClick={() => setModal('close')} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <X size={13} strokeWidth={2} />{t.closeTask}
              </button>
            )}
            {canMarkReceived && (
              <button
                className="btn btn-sm"
                onClick={() => act(() => addComment(task.id, t.markReceived), t.receivedAdded)}
                disabled={busy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  background: '#0e7490', color: '#fff', border: 'none',
                  fontWeight: 600, letterSpacing: '0.01em',
                }}
              >
                <Inbox size={13} strokeWidth={2} />{t.markReceived}
              </button>
            )}
            {canComment && (
              <button className="btn btn-ghost btn-sm" onClick={() => setModal('comment')} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <MessageSquare size={13} strokeWidth={2} />{t.addComment}
              </button>
            )}
          </div>
        </div>

        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              [t.taskType,     t.types?.[task.type] || task.type],
              [t.taskAssigned, task.current_dept_id ? (t.groupLabels?.[task.current_dept_id] || task.current_dept_id) : '—'],
              [t.taskSource,   task.source_entity  || '—'],
              [t.taskDelivery, task.delivery_method || '—'],
              [t.taskCreated,  task.created_at?.slice(0, 16)],
              [t.taskExpected, task.expected_at    || '—'],
              task.completed_at && [t.taskCompleted, task.completed_at?.slice(0, 16)],
            ].filter(Boolean).map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Dept form data */}
          {(() => {
            let ed = null;
            try { ed = task.extra_data ? (typeof task.extra_data === 'string' ? JSON.parse(task.extra_data) : task.extra_data) : null; } catch (_) {}
            if (!ed || !ed._form_id) return null;
            const formDept = depts.find(d => d.id === ed._form_id);
            if (!formDept) return null;
            return (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.1rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.8rem' }}>
                  {formDept.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.85rem' }}>
                  {formDept.fields.map(f => {
                    if (f.key === '_form_id') return null;
                    const val = ed[f.key];
                    if (val === undefined || val === null || val === '') return null;
                    let display;
                    if (f.type === 'checkbox') display = val ? '✓ نعم' : '✗ لا';
                    else display = String(val);
                    return (
                      <div key={f.key}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.label}</div>
                        <div style={{ marginTop: '0.2rem', fontSize: '0.9rem', wordBreak: 'break-word' }}>{display}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Event timeline */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">{t.taskHistory}</div>
        </div>
        <div className="card-body" style={{ padding: '0.75rem 1.5rem' }}>
          {(!task.events || !task.events.length) ? (
            <div className="text-muted text-sm" style={{ padding: '1rem 0' }}>—</div>
          ) : (
            <div className="timeline">
              {task.events.map((ev, i) => {
                const nextEv = task.events[i + 1];
                const held = (ev.type === 'forwarded' || ev.type === 'created') && nextEv
                  ? daysBetween(ev.created_at, nextEv.created_at)
                  : null;
                return (
                  <div key={ev.id} className={`timeline-item${i === task.events.length - 1 ? ' last' : ''}`}>
                    <div className="timeline-dot">{EVENT_ICONS[ev.type] || <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />}</div>
                    <div className="timeline-content">
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {t.eventTypes?.[ev.type] || ev.type}
                        {ev.type === 'forwarded' && ev.to_dept && (
                          <span style={{ fontWeight: 400, color: 'var(--accent)' }}>{t.groupLabels?.[ev.to_dept] || ev.to_dept}</span>
                        )}
                        {held && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)', padding: '1px 7px', borderRadius: 99, fontWeight: 500 }}>
                            <Clock size={10} strokeWidth={2} />{held}
                          </span>
                        )}
                      </div>
                      {ev.note && <div style={{ color: 'var(--text-2)', fontSize: '0.85rem', marginTop: '0.15rem' }}>{ev.note}</div>}
                      <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                        {ev.actor_name} · {ev.created_at?.slice(0, 16)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {modal === 'forward' && (
        <Modal title={t.forwardTask} onClose={() => setModal(null)}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.selectDeptFwd}</label>
            <select className="form-control" value={toDept} onChange={e => setToDept(e.target.value)}>
              <option value="">— {t.selectDeptFwd} —</option>
              {Object.entries(
                depts.reduce((acc, d) => {
                  const key = d.ldapGroup || d.id;
                  if (!acc[key]) acc[key] = t.groupLabels?.[key] || d.label.split('–')[0].trim();
                  return acc;
                }, {})
              ).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="…" />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" disabled={!toDept || busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => forwardTask(task.id, { to_dept_id: toDept, note }), t.taskForwarded)}>
              <Send size={13} strokeWidth={2} />{t.forwardTask}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'return' && (
        <Modal title={t.returnToCS} onClose={() => setModal(null)}>
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.9rem' }}>{t.confirmReturn}</p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="…" />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => returnTask(task.id, { note }), t.taskReturned)}>
              <RotateCcw size={13} strokeWidth={2} />{t.returnToCS}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'close' && (
        <Modal title={t.closeTask} onClose={() => setModal(null)}>
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.9rem' }}>{t.confirmClose}</p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="…" />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-danger btn-sm" disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => closeTask(task.id, { note }), t.taskClosed)}>
              <X size={13} strokeWidth={2} />{t.closeTask}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'comment' && (
        <Modal title={t.addComment} onClose={() => setModal(null)}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote} *</label>
            <textarea className="form-control" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="…" />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" disabled={!note.trim() || busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => addComment(task.id, note), t.commentAdded)}>
              <MessageSquare size={13} strokeWidth={2} />{t.addComment}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
