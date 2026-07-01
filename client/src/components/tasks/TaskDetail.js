import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { getTask, forwardTask, returnTask, closeTask, addComment, acceptTask, updateTask } from '../../services/taskService';
import { getDepartments } from '../../services/deptService';
import { StatusBadge, PriorityBadge } from './TaskList';
import {
  PlusCircle, ArrowRight, RotateCcw, MessageSquare, CheckCircle,
  ChevronLeft, X, Send, AlertTriangle, Clock, PlayCircle,
  Building2, RefreshCw, Users, Shuffle,
} from 'lucide-react';

const EVENT_ICONS = {
  created:      <PlusCircle    size={14} strokeWidth={1.8} />,
  forwarded:    <Send          size={14} strokeWidth={1.8} />,
  returned:     <RotateCcw     size={14} strokeWidth={1.8} />,
  accepted:     <PlayCircle    size={14} strokeWidth={1.8} />,
  commented:    <MessageSquare size={14} strokeWidth={1.8} />,
  consultation: <Users         size={14} strokeWidth={1.8} />,
  closed:       <CheckCircle   size={14} strokeWidth={1.8} />,
};

const EVENT_COLORS = {
  created:      'var(--accent)',
  forwarded:    '#0e7490',
  returned:     '#b45309',
  accepted:     '#15803d',
  commented:    'var(--text-3)',
  consultation: '#7c3aed',
  closed:       'var(--success)',
};

function daysBetween(from, to, t) {
  const ms = new Date(to) - new Date(from);
  if (isNaN(ms) || ms < 0) return null;
  const d = ms / (1000 * 60 * 60 * 24);
  return d < 1 ? `${Math.round(ms / 60000)}${t.minSuffix}` : `${d.toFixed(1)}${t.daySuffix}`;
}

// Count how many forward→return cycles have completed
function countCycles(events) {
  let cycles = 0;
  for (const ev of (events || [])) {
    if (ev.type === 'returned') cycles++;
  }
  return cycles;
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

// ── Where-is-the-task banner ──────────────────────────────────
function LocationBanner({ task, depts, t }) {
  const isAtCS     = !task.current_dept_id;
  const isReturned = task.status === 'returned';
  const isClosed   = task.status === 'closed';

  if (isClosed) return null;

  if (isAtCS) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem',
        background: isReturned ? '#fef3c7' : 'var(--accent-light)',
        border: `1px solid ${isReturned ? '#d97706' : 'var(--accent)'}`,
        fontSize: '0.85rem', fontWeight: 600,
        color: isReturned ? '#92400e' : 'var(--accent-hover)',
      }}>
        {isReturned
          ? <><RotateCcw size={15} strokeWidth={2} /> {t.returnedFromDeptBanner}</>
          : <><Building2 size={15} strokeWidth={1.8} /> {t.atCSNotSentBanner}</>}
      </div>
    );
  }

  const dept = depts.find(d => d.id === task.current_dept_id);
  const deptName = dept?.label || task.current_dept_id;
  const isInProgress = task.status === 'in_progress';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.6rem 1rem', borderRadius: 8, marginBottom: '1rem',
      background: isInProgress ? '#f0fdf4' : '#eff6ff',
      border: `1px solid ${isInProgress ? '#16a34a' : '#3b82f6'}`,
      fontSize: '0.85rem', fontWeight: 600,
      color: isInProgress ? '#15803d' : '#1d4ed8',
    }}>
      {isInProgress
        ? <><PlayCircle size={15} strokeWidth={2} /> {t.inProgressAtDept.replace('{dept}', deptName)}</>
        : <><Send size={15} strokeWidth={2} /> {t.sentAwaitingReceipt.replace('{dept}', deptName)}</>}
    </div>
  );
}

export default function TaskDetail({ taskId, onBack, onUpdate }) {
  const { t }        = useLang();
  const { user }     = useAuth();
  const [task,    setTask]    = useState(null);
  const [depts,   setDepts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [msg,     setMsg]     = useState('');
  const [modal,   setModal]   = useState(null);
  const [note,    setNote]    = useState('');
  const [toDept,  setToDept]  = useState('');
  const [tagDept, setTagDept] = useState('');

  const isCS = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user?.role);

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
      setTagDept('');
      flash(successMsg);
      onUpdate?.();
    } catch (e) { flash(`ERR:${e.message}`); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page-loading"><span className="spinner" /></div>;
  if (!task)   return <div className="empty-state"><div className="empty-sub">{t.taskNotFound}</div></div>;

  const isClosed   = task.status === 'closed';
  const isMyDept   = !isCS && task.current_dept_id === (user?.dept_id || '');
  const cycles     = countCycles(task.events);

  // Button visibility
  // Forward = CS sends a task that's still at reception (no dept yet)
  // Reassign = CS moves a task that's already at a dept directly to another dept
  const canForward  = isCS && !task.current_dept_id && !isClosed;
  const canReassign = isCS && !!task.current_dept_id && !isClosed;
  const canClose    = isCS  && !isClosed;
  const canAccept   = isMyDept && (task.status === 'assigned');
  const canReturn   = isMyDept && (task.status === 'assigned' || task.status === 'in_progress');
  const canComment  = !isClosed;

  const isErr = msg.startsWith('ERR:');

  // Forward dept list: only depts with services (proper departments)
  const fwdDepts = depts.filter(d => (d.services || []).length > 0);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <button className="btn btn-ghost btn-sm" onClick={onBack}
        style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
        <ChevronLeft size={15} strokeWidth={2} />{t.tasks}
      </button>

      {msg && (
        <div className={`alert ${isErr ? 'alert-error' : 'alert-success'}`}
          style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isErr && <AlertTriangle size={15} strokeWidth={2} />}
          {isErr ? msg.replace('ERR:', '') : msg}
        </div>
      )}

      <LocationBanner task={task} depts={depts} t={t} />

      {/* Task card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <code className="tag">{task.serial}</code>
              <StatusBadge status={task.status} t={t} />
              {isCS && !isClosed ? (
                <select
                  value={task.priority}
                  disabled={busy}
                  title={t.escalatePriorityHint}
                  onChange={async e => {
                    const p = e.target.value;
                    setBusy(true);
                    try {
                      const res = await updateTask(task.id, { priority: p });
                      setTask(res.task);
                      flash(t.priorityUpdated);
                      onUpdate?.();
                    } catch (err) { flash(`ERR:${err.message}`); }
                    finally { setBusy(false); }
                  }}
                  style={{
                    fontSize: '0.75rem', fontWeight: 700, borderRadius: 99,
                    padding: '2px 8px', cursor: 'pointer', border: '1.5px solid',
                    borderColor: task.priority === 'urgent' ? '#C53030' : task.priority === 'high' ? '#B7791F' : task.priority === 'normal' ? '#276749' : '#718096',
                    color: task.priority === 'urgent' ? '#C53030' : task.priority === 'high' ? '#B7791F' : task.priority === 'normal' ? '#276749' : '#718096',
                    background: 'transparent', height: 'auto',
                  }}
                >
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <option key={p} value={p}>{t.priorities?.[p] || p}</option>
                  ))}
                </select>
              ) : (
                <PriorityBadge priority={task.priority} t={t} />
              )}
              {cycles > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', background: '#fef3c7', border: '1px solid #d97706', color: '#92400e', padding: '1px 8px', borderRadius: 99, fontWeight: 700 }}>
                  <RefreshCw size={10} strokeWidth={2.5} /> {cycles} {t.cycleSuffix}
                </span>
              )}
            </div>
            <div className="card-title" style={{ marginTop: '0.35rem' }}>{task.title}</div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canForward && (
              <button className="btn btn-primary btn-sm" onClick={() => setModal('forward')} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <Send size={13} strokeWidth={2} />{t.forwardTask}
              </button>
            )}
            {canReassign && (
              <button className="btn btn-sm" onClick={() => setModal('reassign')} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 600 }}>
                <Shuffle size={13} strokeWidth={2} />{t.reassignTask}
              </button>
            )}
            {canAccept && (
              <button className="btn btn-sm" onClick={() => act(() => acceptTask(task.id), t.confirmReceived)} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#15803d', color: '#fff', border: 'none', fontWeight: 600 }}>
                <PlayCircle size={13} strokeWidth={2} /> {t.acceptStart}
              </button>
            )}
            {canReturn && (
              <button className="btn btn-secondary btn-sm" onClick={() => setModal('return')} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <RotateCcw size={13} strokeWidth={2} />{t.returnToCS}
              </button>
            )}
            {canClose && (
              <button className="btn btn-danger btn-sm" onClick={() => setModal('close')} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <CheckCircle size={13} strokeWidth={2} />{t.closeTask}
              </button>
            )}
            {canComment && (
              <button className="btn btn-ghost btn-sm" onClick={() => setModal('comment')} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <MessageSquare size={13} strokeWidth={2} />{t.addComment}
              </button>
            )}
          </div>
        </div>

        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              [t.taskType,     t.types?.[task.type] || task.type],
              [t.taskAssigned, task.current_dept_id
                ? (depts.find(d => d.id === task.current_dept_id)?.label || task.current_dept_id)
                : t.customerServiceFallback],
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

          {/* Sender info (from CS wizard) */}
          {(() => {
            let ed = null;
            try { ed = task.extra_data ? (typeof task.extra_data === 'string' ? JSON.parse(task.extra_data) : task.extra_data) : null; } catch (_) {}
            if (!ed || (!ed._sender_name && !ed._sender_type)) return null;
            return (
              <div style={{ marginTop: '1.1rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                {ed._sender_type && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.senderLabelField}</div>
                    <div style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{ed._sender_type}</div>
                  </div>
                )}
                {ed._sender_name && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.nameField}</div>
                    <div style={{ marginTop: '0.2rem', fontSize: '0.9rem' }}>{ed._sender_name}</div>
                  </div>
                )}
                {ed._sender_phone && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.phoneField}</div>
                    <div style={{ marginTop: '0.2rem', fontSize: '0.9rem' }} dir="ltr">{ed._sender_phone}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Service-specific fields (fixed for new hierarchical structure) */}
          {(() => {
            let ed = null;
            try { ed = task.extra_data ? (typeof task.extra_data === 'string' ? JSON.parse(task.extra_data) : task.extra_data) : null; } catch (_) {}
            if (!ed || !ed._form_id) return null;

            // Find dept then service in the new structure
            const dept    = depts.find(d => d.id === ed._dept_id);
            const service = dept?.services?.find(s => s.id === ed._form_id);
            const fields  = service?.fields;
            if (!fields?.length) return null;

            const displayFields = fields.filter(f => {
              const val = ed[f.key];
              return val !== undefined && val !== null && val !== '';
            });
            if (!displayFields.length) return null;

            return (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.1rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.8rem' }}>
                  {service.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.85rem' }}>
                  {displayFields.map(f => {
                    const val = ed[f.key];
                    const display = f.type === 'checkbox' ? (val ? t.yesValue : t.noValue) : String(val);
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
          {cycles > 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
              {cycles} {t.cyclesNote}
            </span>
          )}
        </div>
        <div className="card-body" style={{ padding: '0.75rem 1.5rem' }}>
          {(!task.events || !task.events.length) ? (
            <div className="text-muted text-sm" style={{ padding: '1rem 0' }}>—</div>
          ) : (
            <div className="timeline">
              {task.events.map((ev, i) => {
                const nextEv = task.events[i + 1];
                const held = (ev.type === 'forwarded' || ev.type === 'accepted') && nextEv
                  ? daysBetween(ev.created_at, nextEv.created_at, t)
                  : null;
                const color = EVENT_COLORS[ev.type] || 'var(--text-3)';

                // Attach cycle number to each forwarded event
                let cycleLabel = null;
                if (ev.type === 'forwarded') {
                  const cycleNum = task.events.slice(0, i + 1).filter(e => e.type === 'forwarded').length;
                  cycleLabel = cycleNum > 1 ? t.cycleLabel.replace('{n}', cycleNum) : null;
                }

                const deptLabel = (id) => depts.find(d => d.id === id)?.label || id;

                return (
                  <div key={ev.id} className={`timeline-item${i === task.events.length - 1 ? ' last' : ''}`}>
                    <div className="timeline-dot" style={{ color }}>
                      {EVENT_ICONS[ev.type] || <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />}
                    </div>
                    <div className="timeline-content">
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ color }}>
                          {ev.type === 'created'      && t.eventCreated}
                          {ev.type === 'forwarded'    && t.eventForwardedTo}
                          {ev.type === 'returned'     && t.eventReturnedToCS}
                          {ev.type === 'accepted'     && t.eventAcceptedStarted}
                          {ev.type === 'commented'    && t.eventCommented}
                          {ev.type === 'consultation' && t.eventConsultation}
                          {ev.type === 'closed'       && t.eventClosed}
                        </span>
                        {ev.type === 'forwarded' && ev.to_dept && (
                          <span style={{ fontWeight: 700, color: '#0e7490' }}>
                            {deptLabel(ev.to_dept)}
                          </span>
                        )}
                        {ev.type === 'returned' && ev.from_dept && (
                          <span style={{ fontWeight: 400, color: '#b45309', fontSize: '0.82rem' }}>
                            {t.fromDeptLabel.replace('{dept}', deptLabel(ev.from_dept))}
                          </span>
                        )}
                        {ev.type === 'consultation' && ev.to_dept && (
                          <span style={{ fontWeight: 700, color: '#7c3aed' }}>
                            {deptLabel(ev.to_dept)}
                          </span>
                        )}
                        {ev.type === 'consultation' && (
                          <span style={{ fontSize: '0.7rem', background: '#f5f3ff', border: '1px solid #c4b5fd', color: '#6d28d9', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
                            {t.consultationTag}
                          </span>
                        )}
                        {cycleLabel && (
                          <span style={{ fontSize: '0.68rem', background: '#fef3c7', border: '1px solid #d97706', color: '#92400e', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>
                            {cycleLabel}
                          </span>
                        )}
                        {held && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-3)', padding: '1px 7px', borderRadius: 99, fontWeight: 500 }}>
                            <Clock size={10} strokeWidth={2} />{held}
                          </span>
                        )}
                      </div>
                      {ev.note && (
                        <div style={{ color: 'var(--text-2)', fontSize: '0.85rem', marginTop: '0.15rem' }}>{ev.note}</div>
                      )}
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

      {/* ── Forward modal ── */}
      {modal === 'forward' && (
        <Modal title={t.forwardTask} onClose={() => setModal(null)}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.selectDeptFwd} <span className="req">*</span></label>
            <select className="form-control" value={toDept} onChange={e => setToDept(e.target.value)}>
              <option value="">{t.selectDeptPH}</option>
              {fwdDepts.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={t.notePHForDept} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" disabled={!toDept || busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => forwardTask(task.id, { to_dept_id: toDept, note }), t.taskForwarded)}>
              <Send size={13} strokeWidth={2} />{t.forwardTask}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Return modal ── */}
      {modal === 'return' && (
        <Modal title={t.returnToCS} onClose={() => setModal(null)}>
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.9rem' }}>
            {t.returnExplain}
          </p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote} <span className="req">*</span></label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder={t.returnNotePH} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-secondary btn-sm" disabled={!note.trim() || busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => returnTask(task.id, { note }), t.taskReturned)}>
              <RotateCcw size={13} strokeWidth={2} />{t.returnToCS}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Close modal ── */}
      {modal === 'close' && (
        <Modal title={t.closeTask} onClose={() => setModal(null)}>
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.9rem' }}>
            {task.status === 'returned'
              ? t.closeConfirmReturned
              : t.closeConfirmDefault}
          </p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={t.closingNotePH} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-danger btn-sm" disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => closeTask(task.id, { note }), t.taskClosed)}>
              <CheckCircle size={13} strokeWidth={2} />{t.closeTask}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Reassign modal ── */}
      {modal === 'reassign' && (
        <Modal title={t.reassignTask} onClose={() => setModal(null)}>
          <p style={{ marginBottom: '1rem', color: 'var(--text-2)', fontSize: '0.9rem' }}>
            {t.reassignExplain}
          </p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.selectDeptFwd} <span className="req">*</span></label>
            <select className="form-control" value={toDept} onChange={e => setToDept(e.target.value)}>
              <option value="">{t.selectDeptPH}</option>
              {fwdDepts.filter(d => d.id !== task.current_dept_id).map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder={t.reassignNotePH} autoFocus />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-sm" disabled={!toDept || busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 600 }}
              onClick={() => act(() => forwardTask(task.id, { to_dept_id: toDept, note }), t.taskReassigned)}>
              <Shuffle size={13} strokeWidth={2} />{t.reassignTask}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Comment modal ── */}
      {modal === 'comment' && (
        <Modal title={t.addComment} onClose={() => setModal(null)}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">{t.taskNote} <span className="req">*</span></label>
            <textarea className="form-control" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="…" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Users size={13} strokeWidth={2} style={{ color: '#7c3aed' }} />
              {t.consultDeptOptional}
            </label>
            <select className="form-control" value={tagDept} onChange={e => setTagDept(e.target.value)}>
              <option value="">{t.noConsultation}</option>
              {depts.filter(d => (d.services || []).length > 0).map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
            {tagDept && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Users size={12} strokeWidth={2} />
                {t.consultationNotify.replace('{dept}', depts.find(d => d.id === tagDept)?.label || '')}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>{t.cancel}</button>
            <button className="btn btn-primary btn-sm" disabled={!note.trim() || busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              onClick={() => act(() => addComment(task.id, note, tagDept || undefined), t.commentAdded)}>
              <MessageSquare size={13} strokeWidth={2} />{tagDept ? t.sendConsultation : t.addComment}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
