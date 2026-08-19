import React, { useState, useEffect } from 'react';
import { FileText, Clock, CheckCircle2, PlayCircle, RotateCcw } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { getCorrStats, listCorrespondence, getCorrespondence } from '../../services/correspondenceService';
import { StatusBadge, ExtLink, fmtDate } from './constants';
import CorrespondenceDetail from './CorrespondenceDetail';

function StatCard({ icon, label, value, color, bg }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: bg, color }}>{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function CorrespondenceDashboard({ onEdit, onDiscuss, refreshKey }) {
  const { t } = useLang();
  const c = t.corr;

  const [stats, setStats]   = useState(null);
  const [recent, setRecent] = useState([]);
  const [approvable, setAp] = useState([]);
  const [open, setOpen]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState('');

  const load = React.useCallback(() => {
    setLoad(true);
    Promise.all([getCorrStats(), listCorrespondence({ box: 'archive', limit: 7 })])
      .then(([s, l]) => {
        setStats(s.stats);
        setAp(s.canApproveFor || []);
        setRecent(l.items || []);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  const s = stats || {};
  const tiles = [
    { key: 'total',    icon: <FileText size={20} strokeWidth={1.8} />,     color: 'var(--primary)', bg: 'var(--primary-light)' },
    { key: 'pending',  icon: <Clock size={20} strokeWidth={1.8} />,        color: 'var(--warning)', bg: 'var(--warning-bg)' },
    { key: 'done',     icon: <CheckCircle2 size={20} strokeWidth={1.8} />, color: 'var(--success)', bg: 'var(--success-bg)' },
    { key: 'approved', icon: <PlayCircle size={20} strokeWidth={1.8} />,   color: 'var(--accent)',  bg: 'var(--accent-light)' },
    { key: 'returned', icon: <RotateCcw size={20} strokeWidth={1.8} />,    color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  ];

  return (
    <>
      {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{err}</div>}

      <div className="stat-grid">
        {tiles.map(x => (
          <StatCard key={x.key} icon={x.icon} label={c.tiles[x.key]} value={s[x.key] ?? 0} color={x.color} bg={x.bg} />
        ))}
      </div>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <div className="card-header">
          <h2 className="card-title">{c.recentTitle}</h2>
        </div>
        <div className="card-body">
          {!recent.length ? (
            <div className="empty-state"><div className="empty-sub">{c.emptyBox.archive}</div></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{c.subject}</th>
                    <th>{c.sender}</th>
                    <th>{c.fromDept}</th>
                    <th>{c.toDept}</th>
                    <th>{c.date}</th>
                    <th>{c.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(it => (
                    <tr
                      key={it.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => getCorrespondence(it.id).then(r => setOpen(r.item)).catch(e => setErr(e.message))}>
                      <td style={{ fontWeight: 600 }}>{it.subject}</td>
                      <td>
                        {it.from_user_name}
                        <ExtLink ext={it.from_user_ext} title={t.directory.callExt} />
                      </td>
                      <td>{it.from_dept_label}</td>
                      <td>{it.to_dept_label}</td>
                      <td>{fmtDate(it.created_at)}</td>
                      <td><StatusBadge status={it.status} t={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {open && (
        <CorrespondenceDetail
          item={open}
          canApprove={approvable.includes(open.from_dept_id)}
          onClose={() => setOpen(null)}
          onChanged={u => { setOpen(u); load(); }}
          onEdit={it => { setOpen(null); onEdit?.(it); }}
          onDiscuss={onDiscuss} />
      )}
    </>
  );
}
