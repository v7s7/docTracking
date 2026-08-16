import React, { useState } from 'react';
import { X, Printer, Check, XCircle, CheckCircle2, Pencil, Paperclip, Download, MessageCircle } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../common/Toast';
import {
  approveCorrespondence, rejectCorrespondence, completeCorrespondence, downloadAttachment,
  discussCorrespondence,
} from '../../services/correspondenceService';
import { StatusBadge, PriorityBadge, EVENT_ICONS, EVENT_COLORS, fmtDate, fmtDateTime, fmtSize } from './constants';
import PrintLetter from './PrintLetter';

export default function CorrespondenceDetail({ item, canApprove, onClose, onChanged, onEdit, onDiscuss }) {
  const { t, deptName } = useLang();
  const { user } = useAuth();
  const toast = useToast();
  const c = t.corr;

  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [rejecting, setRej] = useState(false);
  const [reason, setReason] = useState('');

  if (!item) return null;

  const myDepts = [user?.dept_id].filter(Boolean);
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);

  const showApprove  = item.status === 'pending'  && canApprove;
  const showComplete = item.status === 'approved' && (isAdmin || myDepts.includes(item.to_dept_id));
  const showEdit     = item.status === 'returned' && item.from_user_id === user?.id;

  async function run(fn, okMsg, ...args) {
    setBusy(true); setErr('');
    try {
      const r = await fn(...args);
      onChanged?.(r.item);
      if (okMsg) toast.success(okMsg);
    }
    catch (e) { toast.error(e.message); setErr(e.message); }
    finally { setBusy(false); }
  }

  async function doReject() {
    if (!reason.trim()) { setErr(c.errReason); return; }
    await run(rejectCorrespondence, c.toastRejected, item.id, reason.trim());
    setRej(false); setReason('');
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3 className="modal-title">{item.subject}</h3>
              <div className="text-sm text-muted">{item.serial}</div>
            </div>
            <button className="modal-close" onClick={onClose} aria-label={t.close || 'إغلاق'}>
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="modal-body">
            {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{err}</div>}

            <div className="corr-meta">
              <div><span>{c.sender}</span><strong>{item.from_user_name}</strong></div>
              <div><span>{c.fromDept}</span><strong>{deptName(item.from_dept_id, item.from_dept_label)}</strong></div>
              <div><span>{c.toDept}</span><strong>{deptName(item.to_dept_id, item.to_dept_label)}</strong></div>
              <div><span>{c.date}</span><strong>{fmtDate(item.created_at)}</strong></div>
              <div><span>{c.priority}</span><PriorityBadge priority={item.priority} t={t} /></div>
              <div><span>{c.status}</span><StatusBadge status={item.status} t={t} /></div>
            </div>

            {item.rejection_reason && (
              <div className="corr-reject-callout">
                <strong>{c.rejectReason}</strong>
                <div>{item.rejection_reason}</div>
              </div>
            )}

            <div className="corr-body-label">{c.body}</div>
            <div className="corr-body">{item.body}</div>

            {!!item.attachments?.length && (
              <>
                <div className="corr-body-label">
                  <Paperclip size={13} strokeWidth={2} /> {c.attachments}
                </div>
                <div className="corr-chips">
                  {item.attachments.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      className="corr-chip corr-chip-btn"
                      onClick={() => downloadAttachment(item.id, a.id, a.file_name).catch(e => toast.error(e.message))}>
                      <Download size={13} strokeWidth={2} />
                      <span className="corr-chip-name">{a.file_name}</span>
                      <span className="corr-chip-size">{fmtSize(a.file_size)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="corr-body-label">{c.timeline}</div>
            <div className="timeline">
              {(item.events || []).map((e, i, arr) => {
                const Icon = EVENT_ICONS[e.type];
                const col  = EVENT_COLORS[e.type] || 'var(--text-3)';
                return (
                  <div className={`timeline-item${i === arr.length - 1 ? ' last' : ''}`} key={e.id || i}>
                    <div className="timeline-dot" style={{ borderColor: col, color: col }}>
                      {Icon ? <Icon size={13} strokeWidth={2.2} /> : <span />}
                    </div>
                    <div className="timeline-content">
                      <div style={{ fontWeight: 700, color: col }}>{c.events[e.type] || e.type}</div>
                      {e.note && (
                        <div className={e.is_reject ? 'corr-reject-callout small' : 'text-sm'}>{e.note}</div>
                      )}
                      <div className="text-sm text-muted">{e.actor_name} · {fmtDateTime(e.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="modal-foot">
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
              <Printer size={14} strokeWidth={2} /> {c.print.button}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await discussCorrespondence(item.id);
                  onClose?.();
                  onDiscuss?.(r.conversation_id);
                } catch (e) { toast.error(e.message); }
              }}>
              <MessageCircle size={14} strokeWidth={2} /> {t.corrDiscuss}
            </button>
            {showEdit && (
              <button className="btn btn-secondary btn-sm" onClick={() => onEdit?.(item)} disabled={busy}>
                <Pencil size={14} strokeWidth={2} /> {c.editResend}
              </button>
            )}
            {showApprove && (
              <>
                <button className="btn btn-danger btn-sm" onClick={() => setRej(true)} disabled={busy}>
                  <XCircle size={14} strokeWidth={2} /> {c.reject}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => run(approveCorrespondence, c.toastApproved, item.id)} disabled={busy}>
                  <Check size={14} strokeWidth={2} /> {c.approve}
                </button>
              </>
            )}
            {showComplete && (
              <button className="btn btn-primary btn-sm" onClick={() => run(completeCorrespondence, c.toastCompleted, item.id)} disabled={busy}>
                <CheckCircle2 size={14} strokeWidth={2} /> {c.complete}
              </button>
            )}
          </div>
        </div>
      </div>

      {rejecting && (
        <div className="modal-overlay" onClick={() => setRej(false)} style={{ zIndex: 600 }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-title">{c.rejectModalTitle}</h3>
              <button className="modal-close" onClick={() => setRej(false)}><X size={16} strokeWidth={2} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{c.rejectReason} <span className="req">*</span></label>
                <textarea
                  className="form-control"
                  rows={5}
                  autoFocus
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={c.rejectReasonPlaceholder} />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setRej(false)}>{t.cancel || 'إلغاء'}</button>
              <button className="btn btn-danger btn-sm" onClick={doReject} disabled={busy || !reason.trim()}>
                {c.rejectConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintLetter item={item} />
    </>
  );
}
