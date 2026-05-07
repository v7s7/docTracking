import React, { useState, useEffect } from 'react';
import { useLang } from '../../context/LangContext';
import { getDashboard } from '../../services/taskService';

const STATUS_COLORS = {
  new:         { bg: '#EBF8FF', color: '#2B6CB0', icon: '🔵' },
  assigned:    { bg: '#FFF9E6', color: '#B7791F', icon: '🟡' },
  in_progress: { bg: '#EBF8FF', color: '#2C7A7B', icon: '🟢' },
  returned:    { bg: '#FFF5F5', color: '#C53030', icon: '🔴' },
  closed:      { bg: '#F0FFF4', color: '#276749', icon: '✅' },
};

function StatCard({ icon, label, value, color = 'var(--primary)' }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value" style={{ color }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function StatusPill({ status, t }) {
  const c = STATUS_COLORS[status] || { bg: '#f0f0f0', color: '#666' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700 }}>
      {c.icon} {t.statuses?.[status] || status}
    </span>
  );
}

function PriorityDot({ priority }) {
  const colors = { low: '#718096', normal: '#276749', high: '#B7791F', urgent: '#C53030' };
  return (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[priority] || '#ccc', display: 'inline-block', marginInlineEnd: '0.35rem' }} />
  );
}

export default function Dashboard({ onTaskClick }) {
  const { t }          = useLang();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then(d => setStats(d.stats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page-loading"><span className="spinner" /><span>{t.loading}</span></div>;
  }

  const bs = stats?.byStatus || {};
  const open = (bs.new || 0) + (bs.assigned || 0) + (bs.in_progress || 0);
  const total = Object.values(bs).reduce((s, n) => s + n, 0);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      {/* Stat cards */}
      <div className="stat-grid">
        <StatCard icon="📋" label={t.totalTasks}    value={total}            color="var(--primary)" />
        <StatCard icon="⏳" label={t.openTasks}     value={open}             color="var(--warning)" />
        <StatCard icon="↩️" label={t.returnedTasks} value={bs.returned || 0} color="var(--danger)" />
        <StatCard icon="✅" label={t.closedTasks}   value={bs.closed || 0}   color="var(--success)" />
        {stats?.totalUsers != null && (
          <StatCard icon="👥" label={t.totalUsers} value={stats.totalUsers} color="var(--accent)" />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: stats?.byDept?.length ? '1fr 1fr' : '1fr', gap: '1.25rem', marginTop: '1.5rem' }}>
        {/* Recent tasks */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t.recentTasks}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {!stats?.recentTasks?.length ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
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
                  </tr>
                </thead>
                <tbody>
                  {stats.recentTasks.map(task => (
                    <tr key={task.id} style={{ cursor: 'pointer' }} onClick={() => onTaskClick?.(task.id)}>
                      <td><code className="tag">{task.serial}</code></td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <PriorityDot priority={task.priority} />{task.title}
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
              {stats.byDept.map(row => (
                <div key={row.dept_id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                  <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-2)' }}>
                    {t.groupLabels?.[row.dept_id] || row.dept_id || 'خدمة العملاء'}
                  </div>
                  <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      height: 8, borderRadius: 99, background: 'var(--accent)',
                      width: `${Math.min(100, (row.n / (stats?.recentTasks?.length || 1)) * 100)}%`,
                      minWidth: 20,
                    }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', minWidth: 22 }}>{row.n}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
