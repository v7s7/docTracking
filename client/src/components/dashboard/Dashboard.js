import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getDashboard } from '../../services/taskService';
import { getDepartments } from '../../services/deptService';
import { useAuth } from '../../context/AuthContext';
import { isOverdue } from '../tasks/TaskList';
import MyTasks from './MyTasks';
import {
  FileText, Clock, RotateCcw, CheckCircle, AlertCircle, Users, Inbox, Building2,
} from 'lucide-react';

const STATUS_COLORS = {
  new:         { bg: '#FFF0F0', color: '#C41E1E' },
  assigned:    { bg: '#FFFBEA', color: '#B7791F' },
  in_progress: { bg: '#EAF4EA', color: '#2D6E2D' },
  returned:    { bg: '#FFF5F5', color: '#9A1818' },
  closed:      { bg: '#F0FFF4', color: '#276749' },
};

function StatCard({ icon, label, value, color = 'var(--primary)' }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-icon" style={{ color }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function StatusPill({ status, t }) {
  const c = STATUS_COLORS[status] || { bg: '#f0f0f0', color: '#666' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700 }}>
      {t.statuses?.[status] || status}
    </span>
  );
}

function PriorityDot({ priority }) {
  const colors = { low: '#718096', normal: '#276749', high: '#B7791F', urgent: '#C53030' };
  return (
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[priority] || '#ccc', display: 'inline-block', marginInlineEnd: '0.4rem', flexShrink: 0 }} />
  );
}

const CAN_FILTER = ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'];

export default function Dashboard({ onTaskClick }) {
  const { t }    = useLang();
  const { user } = useAuth();
  const canFilter = CAN_FILTER.includes(user?.role);

  const [stats,   setStats]   = useState(null);
  const [depts,   setDepts]   = useState([]);
  const [dept,    setDept]    = useState('');   // '' = all
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (canFilter) getDepartments().then(setDepts).catch(() => {});
  }, [canFilter]);

  const load = useCallback(() => {
    setLoading(true);
    const params = dept ? { dept } : {};
    getDashboard(params)
      .then(d => setStats(d.stats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dept]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="page-loading"><span className="spinner" /><span>{t.loading}</span></div>;
  }

  const bs      = stats?.byStatus || {};
  const open    = (bs.new || 0) + (bs.assigned || 0) + (bs.in_progress || 0);
  const total   = Object.values(bs).reduce((s, n) => s + n, 0);
  const overdue = (stats?.recentTasks || []).filter(isOverdue).length;

  const deptLabel = dept
    ? (depts.find(d => d.id === dept)?.label || dept)
    : t.allDepartments;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>

      {/* Dept filter for admins */}
      {canFilter && depts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <Building2 size={15} strokeWidth={1.8} style={{ color: 'var(--text-3)' }} />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 600 }}>{t.viewingDept}</span>
          <select
            className="form-control"
            style={{ width: 'auto', padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
            value={dept}
            onChange={e => setDept(e.target.value)}
          >
            <option value="">{t.allDepartments}</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          {dept && (
            <span style={{ fontSize: '0.78rem', background: 'var(--accent-light)', color: 'var(--accent-hover)', borderRadius: 20, padding: '0.15rem 0.65rem', fontWeight: 600 }}>
              {deptLabel}
            </span>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="stat-grid">
        <StatCard icon={<FileText size={22} strokeWidth={1.5} />}    label={t.totalTasks}    value={total}            color="var(--primary)" />
        <StatCard icon={<Clock size={22} strokeWidth={1.5} />}       label={t.openTasks}     value={open}             color="var(--warning)" />
        <StatCard icon={<RotateCcw size={22} strokeWidth={1.5} />}   label={t.returnedTasks} value={bs.returned || 0} color="var(--danger)" />
        <StatCard icon={<CheckCircle size={22} strokeWidth={1.5} />} label={t.closedTasks}   value={bs.closed || 0}   color="var(--success)" />
        {overdue > 0 && (
          <StatCard icon={<AlertCircle size={22} strokeWidth={1.5} />} label={t.overdueTasks} value={overdue} color="var(--danger)" />
        )}
        {stats?.totalUsers != null && (
          <StatCard icon={<Users size={22} strokeWidth={1.5} />} label={t.totalUsers} value={stats.totalUsers} color="var(--accent)" />
        )}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <MyTasks />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: stats?.byDept?.length ? '1fr 1fr' : '1fr', gap: '1.25rem', marginTop: '1.5rem' }}>
        {/* Recent tasks */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t.recentTasks}</div>
            {dept && <div className="card-subtitle">{deptLabel}</div>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            {!stats?.recentTasks?.length ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <div className="empty-icon"><Inbox size={28} strokeWidth={1.4} /></div>
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
                  </tr>
                </thead>
                <tbody>
                  {stats.recentTasks.map(task => (
                    <tr key={task.id} style={{ cursor: 'pointer' }} onClick={() => onTaskClick?.(task.id)}>
                      <td><code className="tag">{task.serial}</code></td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <PriorityDot priority={task.priority} />{task.title}
                        </span>
                      </td>
                      <td><StatusPill status={task.status} t={t} /></td>
                      <td className="text-muted text-sm">{t.priorities?.[task.priority] || task.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* By department */}
        {stats?.byDept?.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">{t.byDept}</div>
            </div>
            <div style={{ padding: '1rem' }}>
              {stats.byDept.map(row => {
                const max = Math.max(...stats.byDept.map(r => r.n), 1);
                return (
                  <div key={row.dept_id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.7rem' }}>
                    <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-2)' }}>
                      {depts.find(d => d.id === row.dept_id)?.label || t.groupLabels?.[row.dept_id] || row.dept_id}
                    </div>
                    <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 99, background: 'var(--accent)', width: `${(row.n / max) * 100}%`, transition: 'width 0.4s ease' }} />
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', minWidth: 22 }}>{row.n}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
