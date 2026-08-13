import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCcw, CheckCircle2, Check, AlertTriangle, Inbox, Send,
  ClipboardList, Users, ArrowLeft, ArrowRight, ShieldAlert,
} from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { getMyDay, getCorrespondence, completeCorrespondence } from '../../services/correspondenceService';
import { useToast } from '../common/Toast';
import CorrespondenceDetail from '../correspondence/CorrespondenceDetail';

// لوحة المتابعة
//
// The old board showed five totals and the seven newest records — the same page
// for a موظف and for a رئيس قسم. But nobody opens this asking "how many are
// there". They open it asking "what is waiting on me", and the answer is
// different for every person and every role.
//
// So the page leads with a list of things only this user can unblock, oldest
// first, each with the one button that moves it on. Counts are still here, but
// small and underneath, because they are context rather than work.

// Each kind of action carries its own icon and its own verb. Colour never
// travels alone — the icon and the label say the same thing.
const KIND = {
  returned: { icon: RotateCcw,    tone: 'danger'  },
  approve:  { icon: CheckCircle2, tone: 'warning' },
  complete: { icon: Check,        tone: 'accent'  },
};

function ActionRow({ a, t, onOpen, onEdit, onComplete, busy }) {
  const c = t.corr;
  const k = KIND[a.kind] || KIND.complete;
  const Icon = k.icon;
  const late = a.days >= 7;

  return (
    <div className={`day-row day-${k.tone}`}>
      <span className="day-icon"><Icon size={15} strokeWidth={2.2} /></span>

      <button className="day-main" onClick={() => onOpen(a.id)}>
        <span className="day-kind">{t.home.kinds[a.kind]}</span>
        <span className="day-subject">{a.subject}</span>
        <span className="day-meta">
          <code className="tag">{a.serial}</code>
          <span>{a.from_dept_label}</span>
          <span className="day-arrow" aria-hidden="true" />
          <span>{a.to_dept_label}</span>
        </span>
      </button>

      {/* Age is what makes something urgent, so it is the second thing read. */}
      <span className={`day-age${late ? ' late' : ''}`}>
        {late && <AlertTriangle size={12} strokeWidth={2.4} />}
        {t.home.waiting.replace('{n}', a.days)}
      </span>

      <span className="day-act">
        {a.kind === 'returned' && (
          <button className="btn btn-primary btn-sm" onClick={() => onEdit(a)}>{c.editResend}</button>
        )}
        {a.kind === 'approve' && (
          <button className="btn btn-primary btn-sm" onClick={() => onOpen(a.id)}>{c.reviewIt}</button>
        )}
        {a.kind === 'complete' && (
          <button className="btn btn-secondary btn-sm" disabled={busy === a.id} onClick={() => onComplete(a.id)}>
            {c.complete}
          </button>
        )}
      </span>
    </div>
  );
}

function Count({ icon, value, label, hint, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`day-count${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <span className="day-count-icon">{icon}</span>
      <span>
        <span className="day-count-value">{value}</span>
        <span className="day-count-label">{label}</span>
        {hint && <span className="day-count-hint">{hint}</span>}
      </span>
    </Tag>
  );
}

export default function HomeDashboard({ onEdit, onDiscuss, onNavigate, refreshKey }) {
  const { t, isRTL } = useLang();
  const toast = useToast();
  const h = t.home;

  const [data, setData]    = useState(null);
  const [err, setErr]      = useState('');
  const [open, setOpen]    = useState(null);
  const [busy, setBusy]    = useState(null);
  const [loading, setLoad] = useState(true);

  const load = useCallback(() => {
    getMyDay()
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function openOne(id) {
    try { const r = await getCorrespondence(id); setOpen(r.item); }
    catch (e) { toast.error(e.message); }
  }

  async function markDone(id) {
    setBusy(id);
    try { await completeCorrespondence(id); toast.success(t.corr.toastCompleted); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (err) return <div className="alert alert-error">{err}</div>;

  const { actions = [], counts = {}, dept, system, scope } = data || {};
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  return (
    <>
      {/* ── What needs you ────────────────────────────────────── */}
      <div className="card day-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">{h.needsYou}</h2>
            <div className="card-subtitle">{h.needsYouHint[scope] || h.needsYouHint.staff}</div>
          </div>
          {!!actions.length && <span className="day-badge">{counts.actions}</span>}
        </div>

        <div className="card-body">
          {!actions.length ? (
            // An empty queue is a result, not an absence — say so plainly.
            <div className="day-clear">
              <span className="day-clear-icon"><CheckCircle2 size={26} strokeWidth={1.6} /></span>
              <div>
                <div className="day-clear-title">{h.allClear}</div>
                <div className="day-clear-sub">{h.allClearHint}</div>
              </div>
            </div>
          ) : (
            <div className="day-list">
              {actions.map(a => (
                <ActionRow
                  key={`${a.kind}-${a.id}`} a={a} t={t} busy={busy}
                  onOpen={openOne} onEdit={onEdit} onComplete={markDone} />
              ))}
              {counts.actions > actions.length && (
                <button className="btn btn-ghost btn-sm day-more" onClick={() => onNavigate?.('corr-archive')}>
                  {h.andMore.replace('{n}', counts.actions - actions.length)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Where things stand ────────────────────────────────── */}
      <div className="day-counts">
        <Count
          icon={<Send size={17} strokeWidth={1.9} />}
          value={counts.iSentOpen ?? 0} label={h.iSentOpen} hint={h.iSentDone.replace('{n}', counts.iSentDone ?? 0)}
          onClick={() => onNavigate?.('corr-archive')} />
        <Count
          icon={<Inbox size={17} strokeWidth={1.9} />}
          value={counts.deptIncoming ?? 0} label={h.deptIncoming}
          onClick={() => onNavigate?.('corr-inbox')} />
        <Count
          icon={<ClipboardList size={17} strokeWidth={1.9} />}
          value={counts.tasksOpen ?? 0} label={h.myTasks}
          hint={counts.tasksOverdue ? h.tasksOverdue.replace('{n}', counts.tasksOverdue) : undefined} />
        {dept && (
          <Count
            icon={<CheckCircle2 size={17} strokeWidth={1.9} />}
            value={dept.awaitingMe} label={h.awaitingMe}
            hint={dept.oldestDays ? h.oldestWaiting.replace('{n}', dept.oldestDays) : undefined}
            onClick={() => onNavigate?.('corr-approvals')} />
        )}
      </div>

      {/* ── My department, for a رئيس قسم or نائب ─────────────── */}
      {dept && (
        <div className="card day-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{h.myDept}</h2>
              <div className="card-subtitle">{dept.labels.join(' · ')}</div>
            </div>
          </div>
          <div className="card-body day-deptgrid">
            <div><span className="day-stat">{dept.sentOpen}</span><span>{h.deptSentOpen}</span></div>
            <div><span className="day-stat">{dept.awaitingMe}</span><span>{h.awaitingMe}</span></div>
            <div><span className="day-stat">{dept.doneTotal}</span><span>{h.deptDone}</span></div>
          </div>
        </div>
      )}

      {/* ── System health, for مدير النظام ────────────────────── */}
      {system && (
        <div className="card day-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{h.systemHealth}</h2>
              <div className="card-subtitle">{h.systemHealthHint}</div>
            </div>
          </div>
          <div className="card-body">
            {!system.departmentsWithoutApprover.length && !system.usersWithoutDept ? (
              <div className="day-clear">
                <span className="day-clear-icon"><CheckCircle2 size={26} strokeWidth={1.6} /></span>
                <div>
                  <div className="day-clear-title">{h.systemOk}</div>
                  <div className="day-clear-sub">{h.systemOkHint}</div>
                </div>
              </div>
            ) : (
              <div className="day-issues">
                {!!system.departmentsWithoutApprover.length && (
                  <button className="day-issue" onClick={() => onNavigate?.('users')}>
                    <ShieldAlert size={16} strokeWidth={2} />
                    <span>
                      <strong>{h.noApprover.replace('{n}', system.departmentsWithoutApprover.length)}</strong>
                      <span className="day-issue-sub">{system.departmentsWithoutApprover.join('، ')}</span>
                    </span>
                    <Arrow size={14} strokeWidth={2} />
                  </button>
                )}
                {!!system.usersWithoutDept && (
                  <button className="day-issue" onClick={() => onNavigate?.('users')}>
                    <Users size={16} strokeWidth={2} />
                    <span>
                      <strong>{h.noDept.replace('{n}', system.usersWithoutDept)}</strong>
                      <span className="day-issue-sub">{h.noDeptHint}</span>
                    </span>
                    <Arrow size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <CorrespondenceDetail
          item={open}
          canApprove={actions.some(a => a.id === open.id && a.kind === 'approve')}
          onClose={() => setOpen(null)}
          onChanged={u => { setOpen(u); load(); }}
          onEdit={it => { setOpen(null); onEdit?.(it); }}
          onDiscuss={onDiscuss} />
      )}
    </>
  );
}
