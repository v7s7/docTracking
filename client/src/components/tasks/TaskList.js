import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getTasks } from '../../services/taskService';

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
    <span style={{ background: '#FFF5F5', color: '#C53030', border: '1px solid #FEB2B2', padding: '1px 8px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, marginInlineStart: '0.35rem' }}>
      ⚠ {t.overdue || 'Overdue'}
    </span>
  );
}

export default function TaskList({ onSelect, createButton }) {
  const { t } = useLang();
  const [tasks,   setTasks]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', search: '' });

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
            <input
              className="form-control"
              style={{ minWidth: 180, padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
              placeholder={`🔍 ${t.search || '…'}`}
              value={filters.search}
              onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
            />
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

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="page-loading" style={{ height: 200 }}>
              <span className="spinner" /><span>{t.loading}</span>
            </div>
          ) : !tasks.length ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-sub">{t.noTasks}</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
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
                  const overdue = isOverdue(task);
                  return (
                    <tr
                      key={task.id}
                      style={{
                        cursor: 'pointer',
                        background: overdue ? '#fff8f8' : undefined,
                        borderInlineStart: overdue ? '3px solid #C53030' : '3px solid transparent',
                      }}
                      onClick={() => onSelect?.(task.id)}
                    >
                      <td><code className="tag">{task.serial}</code></td>
                      <td style={{ maxWidth: 280 }}>
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
    </div>
  );
}
