import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, Clock, RotateCcw, FileText, Download, AlertTriangle } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { getCorrReports } from '../../services/correspondenceService';
import { exportArchive } from '../../services/correspondenceService';
import { useToast } from '../common/Toast';

// Every chart here plots ONE series, so identity never needs a second hue:
// bars take the brand green and the title says what is plotted. That keeps us
// clear of the categorical palette rules entirely — and one hue at 5.32:1 on
// white comfortably clears the 3:1 floor for marks.
const RANGES = ['30', '90', '365', 'all'];

const fmtH = h => {
  if (h == null) return '—';
  if (h < 24) return `${h} س`;
  return `${Math.round(h / 24 * 10) / 10} ي`;
};

/* Horizontal bars: long Arabic category names need the room, and the value
   rides the tip where there is always space for it. */
function BarRow({ label, value, max, suffix }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className="rep-row">
      <div className="rep-row-label" title={label}>{label}</div>
      <div className="rep-row-track">
        <div className="rep-row-bar" style={{ inlineSize: `${pct}%` }} />
      </div>
      <div className="rep-row-val">{value}{suffix || ''}</div>
    </div>
  );
}

/* Columns for the time series. 4px rounded cap, square at the baseline, capped
   thickness so the band keeps its air, 2px surface gaps between neighbours. */
function MonthColumns({ data, t }) {
  const max = Math.max(1, ...data.map(d => d.n));
  return (
    <div className="rep-cols" role="img" aria-label={t.reports.byMonth}>
      {data.map(d => (
        <div className="rep-col" key={d.month} title={`${d.month} · ${d.n}`}>
          <div className="rep-col-val">{d.n}</div>
          <div className="rep-col-track">
            <div className="rep-col-bar" style={{ blockSize: `${(d.n / max) * 100}%` }} />
          </div>
          <div className="rep-col-x">{d.month.slice(5)}/{d.month.slice(2, 4)}</div>
        </div>
      ))}
    </div>
  );
}

function Tile({ icon, label, value, hint, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{
        background: tone ? `var(--${tone}-bg, var(--primary-light))` : 'var(--primary-light)',
        color: tone ? `var(--${tone})` : 'var(--primary)',
      }}>{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="rep-tile-hint">{hint}</div>}
      </div>
    </div>
  );
}

export default function Reports() {
  const { t } = useLang();
  const toast = useToast();
  const r = t.reports;

  const [range, setRange]  = useState('90');
  const [data, setData]    = useState(null);
  const [loading, setLoad] = useState(true);
  const [err, setErr]      = useState('');

  const load = useCallback(() => {
    setLoad(true); setErr('');
    const params = {};
    if (range !== 'all') {
      const d = new Date();
      d.setDate(d.getDate() - Number(range));
      params.from = d.toISOString().slice(0, 10);
    }
    getCorrReports(params)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const topDepts = useMemo(() => (data?.byDepartment || []).slice(0, 8), [data]);
  const services = useMemo(
    () => (data?.byService || []).map(s => ({ ...s, label: s.label || r.otherType })).slice(0, 8),
    [data, r]
  );

  if (loading && !data) return <div className="page-loading"><div className="spinner" /></div>;
  if (err) return <div className="alert alert-error">{err}</div>;

  const s = data?.summary || {};
  const maxDept = Math.max(1, ...topDepts.map(d => d.total));
  const maxSvc  = Math.max(1, ...services.map(x => x.count));

  return (
    <div className={loading ? 'rep-reloading' : ''}>
      {/* Filters: one row, above everything, scoping every number below. */}
      <div className="rep-filters">
        <div className="corr-chiprow" style={{ border: 'none', padding: 0 }}>
          {RANGES.map(x => (
            <button key={x} className={`corr-filter${range === x ? ' active' : ''}`} onClick={() => setRange(x)}>
              {r.ranges[x]}
            </button>
          ))}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => exportArchive(range === 'all' ? {} : { from: (() => {
            const d = new Date(); d.setDate(d.getDate() - Number(range)); return d.toISOString().slice(0, 10);
          })() }).catch(e => toast.error(e.message))}>
          <Download size={14} strokeWidth={2} /> {r.exportExcel}
        </button>
      </div>

      <div className="stat-grid">
        <Tile icon={<FileText size={20} strokeWidth={1.8} />}  label={r.total}      value={s.total ?? 0} />
        <Tile icon={<Clock size={20} strokeWidth={1.8} />}     label={r.avgApprove} value={fmtH(s.avgApprovalHours)}   hint={r.avgApproveHint} tone="warning" />
        <Tile icon={<BarChart3 size={20} strokeWidth={1.8} />} label={r.avgDone}    value={fmtH(s.avgCompletionHours)} hint={r.avgDoneHint}    tone="success" />
        <Tile icon={<RotateCcw size={20} strokeWidth={1.8} />} label={r.rejectRate} value={`${s.rejectionRate ?? 0}%`}  hint={r.rejectRateHint} tone="danger" />
      </div>

      {!!(data?.byMonth || []).length && (
        <div className="card rep-card">
          <div className="card-header"><h2 className="card-title">{r.byMonth}</h2></div>
          <div className="card-body"><MonthColumns data={data.byMonth} t={t} /></div>
        </div>
      )}

      <div className="rep-two">
        <div className="card rep-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{r.byDept}</h2>
              <div className="card-subtitle">{r.byDeptHint}</div>
            </div>
          </div>
          <div className="card-body">
            {!topDepts.length ? <div className="empty-sub">{r.noData}</div>
              : topDepts.map(d => <BarRow key={d.id} label={d.label} value={d.total} max={maxDept} />)}
          </div>
        </div>

        <div className="card rep-card">
          <div className="card-header"><h2 className="card-title">{r.byType}</h2></div>
          <div className="card-body">
            {!services.length ? <div className="empty-sub">{r.noData}</div>
              : services.map(x => <BarRow key={x.id} label={x.label} value={x.count} max={maxSvc} />)}
          </div>
        </div>
      </div>

      {/* More than ~7 meaningful classes → a table, not more colour. */}
      <div className="card rep-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">{r.deptTable}</h2>
            <div className="card-subtitle">{r.deptTableHint}</div>
          </div>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.corr.fromDept}</th><th>{r.sent}</th><th>{r.received}</th><th>{r.total}</th></tr>
              </thead>
              <tbody>
                {(data?.byDepartment || []).map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.label}</td>
                    <td className="rep-num">{d.sent}</td>
                    <td className="rep-num">{d.received}</td>
                    <td className="rep-num" style={{ fontWeight: 700 }}>{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {!!(data?.backlog || []).length && (
        <div className="card rep-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{r.backlog}</h2>
              <div className="card-subtitle">{r.backlogHint}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t.corr.serial}</th><th>{t.corr.subject}</th><th>{t.corr.fromDept}</th><th>{t.corr.sender}</th><th>{r.waiting}</th></tr>
                </thead>
                <tbody>
                  {data.backlog.map(b => (
                    <tr key={b.id}>
                      <td><code className="tag">{b.serial}</code></td>
                      <td style={{ fontWeight: 600 }}>{b.subject}</td>
                      <td>{b.from_dept_label}</td>
                      <td>{b.from_user_name}</td>
                      <td className="rep-num">
                        {/* Status colour always ships with an icon, never colour alone. */}
                        <span className={`rep-days${b.days >= 7 ? ' late' : ''}`}>
                          {b.days >= 7 && <AlertTriangle size={12} strokeWidth={2.4} />}
                          {r.days.replace('{n}', b.days)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!!(data?.approvers || []).length && (
        <div className="card rep-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{r.approvers}</h2>
              <div className="card-subtitle">{r.approversHint}</div>
            </div>
          </div>
          <div className="card-body">
            <div className="table-wrap">
              <table>
                <thead><tr><th>{r.approver}</th><th>{r.decisions}</th><th>{r.avgTime}</th></tr></thead>
                <tbody>
                  {data.approvers.map(a => (
                    <tr key={a.name}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td className="rep-num">{a.n}</td>
                      <td className="rep-num">{fmtH(a.avg_h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
