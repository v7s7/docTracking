import React, { useState, useEffect, useCallback } from 'react';
import { Search, Inbox, CheckCircle2, RotateCcw, Archive as ArchiveIcon, Check, XCircle, Eye, Pencil } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../common/Toast';
import {
  listCorrespondence, getCorrespondence, completeCorrespondence,
} from '../../services/correspondenceService';
import { StatusBadge, PriorityBadge, ExtLink, fmtDate } from './constants';
import CorrespondenceDetail from './CorrespondenceDetail';

// One component behind all four screens — they differ only in which server-side
// box they read, which filter chips they offer, and whether rows render as a
// table or as cards. Keeping them together is what stops the four drifting.
const BOXES = {
  inbox:     { icon: Inbox,        variant: 'table', chips: ['', 'approved', 'done'] },
  approvals: { icon: CheckCircle2, variant: 'cards', chips: [] },
  returned:  { icon: RotateCcw,    variant: 'cards', chips: [] },
  archive:   { icon: ArchiveIcon,  variant: 'table', chips: ['', 'done', 'approved', 'returned', 'pending'] },
};

export default function CorrespondenceList({ box, canApproveFor = [], myDepartments = [], onEdit, onDiscuss, refreshKey }) {
  const { t, deptName } = useLang();
  const { user } = useAuth();
  const toast = useToast();
  const c = t.corr;
  const conf = BOXES[box] || BOXES.archive;

  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(null);
  const [busyId, setBusy]   = useState(null);

  const load = useCallback(() => {
    setLoad(true); setErr('');
    listCorrespondence({ box, ...(status ? { status } : {}), ...(search ? { search } : {}) })
      .then(r => setItems(r.items || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, [box, status, search]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setStatus(''); setSearch(''); }, [box]);

  async function openOne(id) {
    try { const r = await getCorrespondence(id); setOpen(r.item); }
    catch (e) { setErr(e.message); }
  }

  async function markDone(id) {
    setBusy(id);
    try { await completeCorrespondence(id); toast.success(c.toastCompleted); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  }

  const Icon = conf.icon;
  const canApproveThis = it => canApproveFor.includes(it.from_dept_id);

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">{c.nav[box]}</h2>
            <div className="card-subtitle">{c.boxHints[box]}</div>
          </div>
          {box !== 'approvals' && box !== 'returned' && (
            <div className="corr-search">
              <Search size={15} strokeWidth={2} />
              <input
                className="form-control form-control-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={c.searchPlaceholder} />
            </div>
          )}
        </div>

        {!!conf.chips.length && (
          <div className="corr-chiprow">
            {conf.chips.map(s => (
              <button
                key={s || 'all'}
                className={`corr-filter${status === s ? ' active' : ''}`}
                onClick={() => setStatus(s)}>
                {s ? c.statuses[s] : c.all}
              </button>
            ))}
          </div>
        )}

        <div className="card-body">
          {err && <div className="alert alert-error">{err}</div>}

          {loading ? (
            <div className="page-loading"><div className="spinner" /></div>
          ) : !items.length ? (
            <div className="empty-state">
              <div className="empty-icon"><Icon size={30} strokeWidth={1.5} /></div>
              <div className="empty-sub">{c.emptyBox[box]}</div>
            </div>
          ) : conf.variant === 'table' ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{c.serial}</th>
                    <th>{c.subject}</th>
                    <th>{c.sender}</th>
                    <th>{c.fromDept}</th>
                    <th>{c.toDept}</th>
                    <th>{c.date}</th>
                    <th>{c.status}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id} onClick={() => openOne(it.id)} style={{ cursor: 'pointer' }}>
                      <td><code className="tag">{it.serial}</code></td>
                      <td style={{ fontWeight: 600 }}>{it.subject}</td>
                      <td>
                        {it.from_user_name}
                        <ExtLink ext={it.from_user_ext} title={t.directory.callExt} />
                      </td>
                      <td>{deptName(it.from_dept_id, it.from_dept_label)}</td>
                      <td>{deptName(it.to_dept_id, it.to_dept_label)}</td>
                      <td>{fmtDate(it.created_at)}</td>
                      <td><StatusBadge status={it.status} t={t} /></td>
                      <td onClick={e => e.stopPropagation()}>
                        {/* The inbox now also carries memos that have come BACK
                            to قسم A after a reply, so "in the inbox" is no longer
                            the same as "we are the receiving department". Only
                            قسم B closes, so check that explicitly. */}
                        {box === 'inbox' && it.status === 'approved' && myDepartments.includes(it.to_dept_id) && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busyId === it.id}
                            onClick={() => markDone(it.id)}>
                            <Check size={13} strokeWidth={2.4} /> {c.complete}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="corr-cards">
              {items.map(it => (
                <div className="corr-card" key={it.id}>
                  <div className="corr-card-head">
                    <div>
                      <div className="corr-card-subject">{it.subject}</div>
                      <div className="text-sm text-muted">
                        <code className="tag">{it.serial}</code> · {it.from_user_name}
                        <ExtLink ext={it.from_user_ext} title={t.directory.callExt} variant="inline" /> ·{' '}
                        {deptName(it.from_dept_id, it.from_dept_label)} ← {deptName(it.to_dept_id, it.to_dept_label)} · {fmtDate(it.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <PriorityBadge priority={it.priority} t={t} />
                      <StatusBadge status={it.status} t={t} />
                    </div>
                  </div>

                  {box === 'approvals' && <div className="corr-card-body">{it.body}</div>}

                  {box === 'returned' && it.rejection_reason && (
                    <div className="corr-reject-callout">
                      <strong>{c.rejectReason}</strong>
                      <div>{it.rejection_reason}</div>
                    </div>
                  )}

                  <div className="corr-card-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => openOne(it.id)}>
                      <Eye size={14} strokeWidth={2} /> {c.viewDetails}
                    </button>
                    {box === 'returned' && (
                      <button className="btn btn-primary btn-sm" onClick={() => onEdit?.(it)}>
                        <Pencil size={14} strokeWidth={2} /> {c.editResend}
                      </button>
                    )}
                    {box === 'approvals' && canApproveThis(it) && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openOne(it.id)}>
                        <XCircle size={14} strokeWidth={2} /> {c.reviewIt}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <CorrespondenceDetail
          item={open}
          canApprove={canApproveThis(open)}
          myDepartments={myDepartments}
          onClose={() => setOpen(null)}
          onChanged={updated => { setOpen(updated); load(); }}
          onEdit={it => { setOpen(null); onEdit?.(it); }}
          onDiscuss={onDiscuss} />
      )}
    </>
  );
}
