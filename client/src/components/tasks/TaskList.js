import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getTasks } from '../../services/taskService';

const STATUS_COLORS = {
  new:         { bg: '#EBF8FF', color: '#2B6CB0' },
  assigned:    { bg: '#FFFBEA', color: '#B7791F' },
  in_progress: { bg: '#E6FFFA', color: '#2C7A7B' },
  returned:    { bg: '#FFF5F5', color: '#C53030' },
  closed:      { bg: '#F0FFF4', color: '#276749' },
};

const PRIORITY_COLORS = {
  low:    '#718096',
  normal: '#276749',
  high:   '#B7791F',
  urgent: '#C53030',
};

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

export default function TaskList({ onSelect, createButton }) {
  const { t } = useLang();
  const [tasks,  setTasks]  = useState([]);
  const [total,  setTotal]  = useState(0);
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

  function setFilter(k, v) {
    setFilters(p => ({ ...p, [k]: v }));
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
            <input
              className="form-control"
              style={{ minWidth: 180, padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
              placeholder={`🔍 ${t.search || 'Search…'}`}
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
            />
            <select
              className="form-control"
              style={{ width: 'auto', padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
              value={filters.status}
              onChange={e => setFilter('status', e.target.value)}
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
                  <th>{t.taskCreated}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr
                    key={task.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect?.(task.id)}
                  >
                    <td><code className="tag">{task.serial}</code></td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                      {task.source_entity && <div className="text-sm text-muted">{task.source_entity}</div>}
                    </td>
                    <td><StatusBadge status={task.status} t={t} /></td>
                    <td><PriorityBadge priority={task.priority} t={t} /></td>
                    <td className="text-sm text-muted">
                      {task.current_dept_id ? (t.groupLabels?.[task.current_dept_id] || task.current_dept_id) : '—'}
                    </td>
                    <td className="text-sm text-muted">
                      {task.created_at?.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
