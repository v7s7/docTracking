import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Pencil, Trash2, Users, Check } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { useToast } from '../common/Toast';
import { fmtDateTime, fmtSize, ExtLink } from '../correspondence/constants';
import {
  getCircReaders, deleteCircular, downloadCircularAttachment,
} from '../../services/circularService';

// Colours come from the correspondence palette rather than new CSS classes:
// this codebase styles .badge inline (see StatusBadge in correspondence/
// constants.js) and has no .badge-success / .badge-warning to reuse.
const READ_STYLE   = { background: '#EAF4EA', color: '#2D6E2D', padding: '0.2rem 0.6rem' };
const UNREAD_STYLE = { background: '#FFFBEA', color: '#B7791F', padding: '0.2rem 0.6rem' };

// Reading the تعميم is what records the receipt — the list marks it read on
// open, so by the time this renders the badge has already gone down.
export default function CircularDetail({ item, onClose, onChanged, onEdit }) {
  const { t, deptName } = useLang();
  const toast = useToast();
  const c = t.circulars;

  const [readers, setReaders] = useState(null);
  const [showReaders, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadReaders = useCallback(() => {
    if (!item?.can_modify) return;
    getCircReaders(item.id).then(setReaders).catch(() => {});
  }, [item]);

  useEffect(() => { if (showReaders) loadReaders(); }, [showReaders, loadReaders]);

  if (!item) return null;

  async function handleDelete() {
    if (!window.confirm(c.deleteConfirm)) return;
    setBusy(true);
    try {
      await deleteCircular(item.id);
      toast?.success?.(c.deleted);
      onChanged?.();
      onClose?.();
    } catch (e) {
      toast?.error?.(e.message);
    } finally { setBusy(false); }
  }

  async function grab(att) {
    try {
      await downloadCircularAttachment(item.id, att.id, att.file_name);
    } catch (e) { toast?.error?.(e.message); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3 style={{ margin: 0 }}>{item.title}</h3>
            <div className="card-subtitle" style={{ marginTop: '.25rem' }}>
              <code className="tag">{item.serial}</code>
              {'  '}
              {c[item.source === 'deputy_chairman' ? 'deputy' : 'director']}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t.close || 'إغلاق'}>×</button>
        </div>

        <div className="card-body">
          <div className="card-subtitle" style={{ marginBottom: '1rem' }}>
            {c.publisher}: <b>{item.published_by_name}</b>
            <ExtLink ext={item.published_by_ext} title={t.directory.callExt} />
            {item.published_by_dept ? `  ·  ${deptName(item.published_by_dept)}` : ''}
            {'  ·  '}{fmtDateTime(item.created_at)}
            {item.edited_at && (
              <span className="tag" style={{ marginInlineStart: '.5rem' }}>
                {c.edited} · {fmtDateTime(item.edited_at)}
              </span>
            )}
          </div>

          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>{item.body}</div>

          {!!item.attachments?.length && (
            <>
              <div className="card-subtitle" style={{ margin: '1.25rem 0 .5rem' }}>{c.attachments}</div>
              <div className="corr-chips">
                {item.attachments.map(a => (
                  <button
                    type="button"
                    key={a.id}
                    className="corr-chip corr-chip-btn"
                    onClick={() => grab(a)}>
                    <FileText size={13} strokeWidth={2} />
                    <span className="corr-chip-name">{a.file_name}</span>
                    <span className="corr-chip-size">{fmtSize(a.file_size)}</span>
                    <Download size={13} strokeWidth={2} />
                  </button>
                ))}
              </div>
            </>
          )}

          {item.can_modify && (
            <div style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShow(v => !v)}>
                <Users size={14} strokeWidth={2} />
                {' '}
                {c.readBy.replace('{n}', item.read_count).replace('{total}', item.audience)}
              </button>

              {showReaders && (
                <div className="table-wrap" style={{ marginTop: '.75rem', maxHeight: 320, overflowY: 'auto' }}>
                  {!readers ? (
                    <div className="page-loading"><div className="spinner" /></div>
                  ) : (
                    <table>
                      <thead>
                        <tr><th>{c.name}</th><th>{t.directory.ext}</th><th>{c.dept}</th><th>{c.status}</th></tr>
                      </thead>
                      <tbody>
                        {readers.read?.map(u => (
                          <tr key={`r${u.id}`}>
                            <td>{u.full_name}</td>
                            <td><ExtLink ext={u.ext} title={t.directory.callExt} /></td>
                            <td>{deptName(u.dept_id)}</td>
                            <td><span className="badge" style={READ_STYLE}><Check size={11} strokeWidth={3} /> {fmtDateTime(u.read_at)}</span></td>
                          </tr>
                        ))}
                        {readers.unread?.map(u => (
                          <tr key={`u${u.id}`}>
                            <td>{u.full_name}</td>
                            <td><ExtLink ext={u.ext} title={t.directory.callExt} /></td>
                            <td>{deptName(u.dept_id)}</td>
                            <td><span className="badge" style={UNREAD_STYLE}>{c.notReadYet}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {item.can_modify && (
          <div className="modal-foot">
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onEdit?.(item)}>
              <Pencil size={13} strokeWidth={2.4} /> {c.edit}
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={handleDelete}>
              <Trash2 size={13} strokeWidth={2.4} /> {c.delete}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
