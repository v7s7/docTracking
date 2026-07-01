import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { getTasks, bulkAction } from '../../services/taskService';
import { getDepartments } from '../../services/deptService';
import { AlertTriangle, Search, Inbox, Send, X, CheckSquare, Clock, RotateCcw } from 'lucide-react';
import { useConfirm } from '../common/ConfirmDialog';

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

// Duration since last update
function sinceNow(dateStr, t) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60)  return `${mins}${t.minSuffix}`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}${t.hourSuffix}`;
  const days = Math.floor(hrs / 24);
  return `${days} ${t.daySuffix}`;
}

// Bulk forward modal
function BulkForwardModal({ count, depts, t, onConfirm, onClose }) {
  const [dept,  setDept]  = useState('');
  const [note,  setNote]  = useState('');
  const [busy,  setBusy]  = useState(false);

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
              {depts.filter(d => (d.services || []).length > 0).map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
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
  const { t }    = useLang();
  const { user } = useAuth();
  const isCS = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(user?.role);

  const [tasks,        setTasks]        = useState([]);
  const [total,        setTotal]        = useState(0);
  const [statusCounts, setStatusCounts] = useState({});
  const [depts,        setDepts]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab,    setActiveTab]    = useState('all');
  const [search,       setSearch]       = useState('');
  const [selected,     setSelected]     = useState(new Set());
  const [showFwd,      setShowFwd]      = useState(false);
  const [flash,        setFlash]        = useState('');
  const [bulkBusy,     setBulkBusy]     = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // Tab → status filter mapping
  const TAB_STATUS = {
    all:        '',
    pending:    'new',       // at CS, not yet sent (CS view) / or all new for depts
    returned:   'returned',
    with_dept:  'assigned',
    in_progress:'in_progress',
    closed:     'closed',
  };

  const csTabs = [
    { id: 'all',         label: t.tabAll },
    { id: 'returned',    label: t.tabReturned,       alert: true },
    { id: 'pending',     label: t.tabPending },
    { id: 'with_dept',   label: t.tabWithDept },
    { id: 'in_progress', label: t.tabInProgress },
    { id: 'closed',      label: t.tabClosed },
  ];

  const deptTabs = [
    { id: 'all',         label: t.tabAll },
    { id: 'with_dept',   label: t.tabAwaitingReceipt, alert: false },
    { id: 'in_progress', label: t.tabInProgress,      alert: false },
    { id: 'closed',      label: t.tabClosed },
  ];

  const tabs = isCS ? csTabs : deptTabs;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      const statusFilter = TAB_STATUS[activeTab];
      if (statusFilter)   params.status = statusFilter;
      if (search.trim())  params.search = search.trim();
      const data = await getTasks(params);
      setTasks(data.tasks || []);
      setTotal(data.total || 0);
      setStatusCounts(data.statusCounts || {});
    } catch (_) {}
    finally { setLoading(false); }
  }, [activeTab, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getDepartments().then(d => setDepts(d || [])).catch(() => {}); }, []);
  useEffect(() => { setSelected(new Set()); }, [activeTab, search]);

  function showFlash(msg) { setFlash(msg); setTimeout(() => setFlash(''), 3000); }

  const openTasks = tasks.filter(tk => tk.status !== 'closed');
  const allOpen   = openTasks.length > 0 && openTasks.every(tk => selected.has(tk.id));

  function toggleAll()   { setSelected(allOpen ? new Set() : new Set(openTasks.map(tk => tk.id))); }
  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBulkClose() {
    if (!await confirm(`${t.bulkClose} (${selected.size})?`)) return;
    setBulkBusy(true);
    try {
      const { processed } = await bulkAction({ action: 'close', task_ids: [...selected] });
      showFlash((t.bulkDone || 'Done — {n} tasks updated.').replace('{n}', processed));
      setSelected(new Set()); load();
    } catch (e) { showFlash(`ERR:${e.message}`); }
    finally { setBulkBusy(false); }
  }

  async function handleBulkForward(dept_id, note) {
    try {
      const { processed } = await bulkAction({ action: 'forward', task_ids: [...selected], dept_id, note });
      showFlash((t.bulkDone || 'Done — {n} tasks updated.').replace('{n}', processed));
      setSelected(new Set()); setShowFwd(false); load();
    } catch (e) { showFlash(`ERR:${e.message}`); }
  }

  function deptLabel(id) {
    if (!id) return t.customerServiceFallback;
    return depts.find(d => d.id === id)?.label || id;
  }

  const returnedCount = statusCounts['returned'] || 0;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      {confirmDialog}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div className="card-title">{t.tasks}</div>
            <div className="card-subtitle">{total} {t.tasks?.toLowerCase()}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} strokeWidth={2} style={{ position: 'absolute', top: '50%', insetInlineStart: '0.6rem', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
              <input
                className="form-control"
                style={{ minWidth: 180, padding: '0.4rem 0.7rem', paddingInlineStart: '2rem', fontSize: '0.85rem' }}
                placeholder={t.search}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {createButton}
          </div>
        </div>

        {/* Status tabs */}
        <div style={{ padding: '0 1.5rem', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '0', minWidth: 'max-content' }}>
            {tabs.map(tab => {
              const statusKey = TAB_STATUS[tab.id];
              const count = tab.id === 'all'
                ? Object.values(statusCounts).reduce((a, b) => a + b, 0)
                : (statusKey ? (statusCounts[statusKey] || 0) : 0);
              const isActive = activeTab === tab.id;
              const isAlert  = tab.alert && count > 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '0.65rem 1rem', background: 'none', border: 'none',
                    borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                    cursor: 'pointer', fontWeight: isActive ? 700 : 400, fontSize: '0.85rem',
                    color: isActive ? 'var(--primary)' : isAlert ? '#C53030' : 'var(--text-2)',
                    transition: 'color 0.1s', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.id === 'returned' && isAlert && (
                    <RotateCcw size={13} strokeWidth={2.5} style={{ color: '#C53030' }} />
                  )}
                  {tab.label}
                  {count > 0 && (
                    <span style={{
                      background: isAlert ? '#C53030' : isActive ? 'var(--primary)' : 'var(--surface-2)',
                      color: (isAlert || isActive) ? '#fff' : 'var(--text-3)',
                      borderRadius: 99, fontSize: '0.68rem', fontWeight: 700,
                      padding: '1px 6px', lineHeight: 1.5, minWidth: 18, textAlign: 'center',
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {flash && (
          <div className={`alert ${flash.startsWith('ERR:') ? 'alert-error' : 'alert-success'}`}
            style={{ margin: '0.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  </th>
                  <th>{t.taskSerial}</th>
                  <th>{t.taskTitle}</th>
                  <th>{t.taskStatus}</th>
                  <th>{t.taskPriority}</th>
                  <th>{t.taskAssigned}</th>
                  <th style={{ minWidth: 90 }}>{t.duration}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => {
                  const overdue     = isOverdue(task);
                  const isClosed    = task.status === 'closed';
                  const isReturned  = task.status === 'returned';
                  const isSelected  = selected.has(task.id);
                  const duration    = sinceNow(task.updated_at, t);

                  return (
                    <React.Fragment key={task.id}>
                      <tr
                        style={{
                          cursor: 'pointer',
                          background: isSelected
                            ? 'var(--primary-light)'
                            : isReturned ? '#fff8f0'
                            : overdue   ? '#fff8f8'
                            : undefined,
                          borderInlineStart: isSelected   ? '3px solid var(--primary)'
                            : isReturned ? '3px solid #d97706'
                            : overdue   ? '3px solid #C53030'
                            : '3px solid transparent',
                        }}
                        onClick={() => onSelect?.(task.id)}
                      >
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          {!isClosed && (
                            <input type="checkbox" checked={isSelected} onChange={() => toggleOne(task.id)}
                              style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                          )}
                        </td>
                        <td><code className="tag">{task.serial}</code></td>
                        <td style={{ maxWidth: 260 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {task.title}
                            {overdue && <OverduePill t={t} />}
                          </div>
                          {task.source_entity && (
                            <div className="text-sm text-muted">{task.source_entity}</div>
                          )}
                        </td>
                        <td><StatusBadge status={task.status} t={t} /></td>
                        <td><PriorityBadge priority={task.priority} t={t} /></td>
                        <td className="text-sm" style={{ color: 'var(--text-2)' }}>
                          {deptLabel(task.current_dept_id)}
                        </td>
                        <td>
                          {duration && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                              fontSize: '0.75rem',
                              color: overdue ? '#C53030' : 'var(--text-3)',
                              fontWeight: overdue ? 700 : 400,
                            }}>
                              <Clock size={11} strokeWidth={2} />{duration}
                            </span>
                          )}
                        </td>
                      </tr>
                      {/* Return note row — shown when task is returned */}
                      {isReturned && task.last_return_note && (
                        <tr style={{
                          background: '#fffbf2',
                          borderInlineStart: '3px solid #d97706',
                        }}>
                          <td />
                          <td colSpan={6} style={{ paddingTop: 0, paddingBottom: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.8rem', color: '#92400e', paddingInlineStart: '0.25rem' }}>
                              <RotateCcw size={12} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
                              <span>
                                <strong>{task.returned_by_name || t.deptFallback}:</strong> {task.last_return_note}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Floating bulk bar */}
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
          {isCS && (
            <button onClick={() => setShowFwd(true)}
              style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Send size={13} strokeWidth={2} />{t.bulkForward}
            </button>
          )}
          {isCS && (
            <button onClick={handleBulkClose} disabled={bulkBusy}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 7, padding: '0.4rem 0.9rem', cursor: bulkBusy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.83rem', opacity: bulkBusy ? 0.6 : 1 }}>
              {bulkBusy ? '…' : t.bulkClose}
            </button>
          )}
          <button onClick={() => setSelected(new Set())}
            style={{ background: 'none', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer', padding: '0.2rem', display: 'flex' }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      {showFwd && (
        <BulkForwardModal count={selected.size} depts={depts} t={t}
          onConfirm={handleBulkForward}
          onClose={() => setShowFwd(false)} />
      )}
    </div>
  );
}
