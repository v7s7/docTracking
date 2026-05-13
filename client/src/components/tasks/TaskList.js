import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getTasks, bulkAction } from '../../services/taskService';
import { getDepartments } from '../../services/deptService';
import { AlertTriangle, Search, Inbox, Send, X, CheckSquare } from 'lucide-react';

const STATUS_COLORS = {
  new:         { bg: '#FFF0F0', color: '#C41E1E' },
  assigned:    { bg: '#FFFBEA', color: '#B7791F' },
  in_progress: { bg: '#EAF4EA', color: '#2D6E2D' },
  returned:    { bg: '#FFF5F5', color: '#9A1818' },
  closed:      { bg: '#F0FFF4', color: '#276749' },
};

const PRIORITY_COLORS = {
  low:    '#718096',
  normal: '#276749',
  high:   '#B7791F',
  urgent: '#C53030',
};

export function isOverdue(task) {
  if (!task.expected_at || task.status === 'closed') return false;
  return new Date(task.expected_at) < new Date();
}

export function StatusBadge({ status, t }) {
  const c = STATUS_COLORS[status] || { bg: '#f0f0f0', color: '#666' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {t.statuses?.[status] || status}
    </span>
  );
}

export function PriorityBadge({ priority, t }) {
  const color = PRIORITY_COLORS[priority] || '#666';
  return (
    <span style={{ color, fontWeight: 600, fontSize: '0.8rem' }}>
      {t.priorities?.[priority] || priority}
    </span>
  );
}

export function OverduePill({ t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', background: '#FFF5F5', color: '#C53030', border: '1px solid #FEB2B2', padding: '1px 7px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, marginInlineStart: '0.35rem' }}>
      <AlertTriangle size={10} strokeWidth={2.5} />{t.overdue || 'Overdue'}
    </span>
  );
}

// ── Bulk forward dept picker modal ───────────────────────────
function BulkForwardModal({ count, t, onConfirm, onClose }) {
  const [depts,  setDepts]  = useState([]);
  const [dept,   setDept]   = useState('');
  const [note,   setNote]   = useState('');
  const [busy,   setBusy]   = useState(false);

  useEffect(() => {
    getDepartments().then(setDepts).catch(() => {});
  }, []);

  async function handleConfirm() {
    if (!dept) return;
    setBusy(true);
    await onConfirm(dept, note);
    setBusy(false);
  }

  const label = (t.selectDeptBulk || 'Forward {n} tasks to:').replace('{n}', count);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Send size={15} strokeWidth={1.8} style={{ color: 'var(--primary)' }} />{label}
          </h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{t.deptAssign} *</label>
            <select className="form-control" value={dept} onChange={e => setDept(e.target.value)} required>
              <option value="">—</option>
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
          <div className="form-group">
            <label className="form-label">{t.taskNote}</label>
            <textarea className="form-control" rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t.cancel}</button>
          <button className="btn btn-primary btn-sm" onClick={handleConfirm} disabled={!dept || busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Send size={13} strokeWidth={2} />{t.bulkForward}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TaskList({ onSelect, createButton }) {
  const { t } = useLang();
  const [tasks,     setTasks]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [filters,   setFilters]   = useState({ status: '', search: '' });
  const [selected,  setSelected]  = useState(new Set());
  const [showFwd,   setShowFwd]   = useState(false);
  const [flash,     setFlash]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      const data = await getTasks(params);
      setTasks(data.tasks);
      setTotal(data.total);
    } catch (_) {}
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [filters]);

  function showFlash(msg) { setFlash(msg); setTimeout(() => setFlash(''), 3000); }

  const openTasks = tasks.filter(t => t.status !== 'closed');
  const allOpen   = openTasks.length > 0 && openTasks.every(t => selected.has(t.id));

  function toggleAll() {
    if (allOpen) {
      setSelected(new Set());
    } else {
      setSelected(new Set(openTasks.map(t => t.id)));
    }
  }

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBulkClose() {
    if (!window.confirm(`${t.bulkClose} (${selected.size})?`)) return;
    try {
      const { processed } = await bulkAction({ action: 'close', task_ids: [...selected] });
      showFlash((t.bulkDone || 'Done — {n} tasks updated.').replace('{n}', processed));
      setSelected(new Set());
      load();
    } catch (e) { showFlash(`ERR:${e.message}`); }
  }

  async function handleBulkForward(dept_id, note) {
    try {
      const { processed } = await bulkAction({ action: 'forward', task_ids: [...selected], dept_id, note });
      showFlash((t.bulkDone || 'Done — {n} tasks updated.').replace('{n}', processed));
      setSelected(new Set());
      setShowFwd(false);
      load();
    } catch (e) { showFlash(`ERR:${e.message}`); }
  }

  const statusOptions = ['', 'new', 'assigned', 'in_progress', 'returned', 'closed'];

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{t.tasks}</div>
            <div className="card-subtitle">{total} {t.tasks.toLowerCase()}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} strokeWidth={2} style={{ position: 'absolute', top: '50%', insetInlineStart: '0.6rem', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
              <input
                className="form-control"
                style={{ minWidth: 180, padding: '0.4rem 0.7rem', paddingInlineStart: '2rem', fontSize: '0.85rem' }}
                placeholder={t.search || '…'}
                value={filters.search}
                onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
              />
            </div>
            <select
              className="form-control"
              style={{ width: 'auto', padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
              value={filters.status}
              onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>{s ? (t.statuses?.[s] || s) : `— ${t.taskStatus} —`}</option>
              ))}
            </select>
            {createButton}
          </div>
        </div>

        {/* Flash message */}
        {flash && (
          <div className={`alert ${flash.startsWith('ERR:') ? 'alert-error' : 'alert-success'}`}
            style={{ margin: '0 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {flash.replace('ERR:', '')}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="page-loading" style={{ height: 200 }}>
              <span className="spinner" /><span>{t.loading}</span>
            </div>
          ) : !tasks.length ? (
            <div className="empty-state">
              <div className="empty-icon"><Inbox size={28} strokeWidth={1.4} /></div>
              <div className="empty-sub">{t.noTasks}</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'center' }}>
                    <input type="checkbox" checked={allOpen} onChange={toggleAll}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                      title={t.selectAll} />
                  </th>
                  <th>{t.taskSerial}</th>
                  <th>{t.taskTitle}</th>
                  <th>{t.taskStatus}</th>
                  <th>{t.taskPriority}</th>
                  <th>{t.taskAssigned}</th>
                  <th>{t.taskExpected}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => {
                  const overdue  = isOverdue(task);
                  const isClosed = task.status === 'closed';
                  const isSelected = selected.has(task.id);
                  return (
                    <tr
                      key={task.id}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--primary-light)' : overdue ? '#fff8f8' : undefined,
                        borderInlineStart: isSelected ? '3px solid var(--primary)' : overdue ? '3px solid #C53030' : '3px solid transparent',
                      }}
                      onClick={() => onSelect?.(task.id)}
                    >
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {!isClosed && (
                          <input type="checkbox" checked={isSelected}
                            onChange={() => toggleOne(task.id)}
                            style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                        )}
                      </td>
                      <td><code className="tag">{task.serial}</code></td>
                      <td style={{ maxWidth: 260 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.title}
                          {overdue && <OverduePill t={t} />}
                        </div>
                        {task.source_entity && <div className="text-sm text-muted">{task.source_entity}</div>}
                      </td>
                      <td><StatusBadge status={task.status} t={t} /></td>
                      <td><PriorityBadge priority={task.priority} t={t} /></td>
                      <td className="text-sm text-muted">
                        {task.current_dept_id ? (t.groupLabels?.[task.current_dept_id] || task.current_dept_id) : '—'}
                      </td>
                      <td className="text-sm" style={{ color: overdue ? 'var(--danger)' : 'var(--text-3)', fontWeight: overdue ? 600 : 400 }}>
                        {task.expected_at || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text)', color: '#fff', borderRadius: 12, padding: '0.75rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          zIndex: 200, whiteSpace: 'nowrap',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
            <CheckSquare size={15} strokeWidth={2} style={{ color: 'var(--primary-light)' }} />
            {selected.size} {t.selected}
          </span>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }} />
          <button onClick={() => setShowFwd(true)}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Send size={13} strokeWidth={2} />{t.bulkForward}
          </button>
          <button onClick={handleBulkClose}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}>
            {t.bulkClose}
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ background: 'none', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer', padding: '0.2rem', display: 'flex' }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      {showFwd && (
        <BulkForwardModal count={selected.size} t={t}
          onConfirm={handleBulkForward}
          onClose={() => setShowFwd(false)} />
      )}
    </div>
  );
}
