import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, X, FileText, AlertTriangle, Send, ArrowLeft, Plus, ShieldCheck, Phone } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import {
  getRequestableDepartments, createCorrespondence, updateCorrespondence,
} from '../../services/correspondenceService';
import DepartmentSelect from '../common/DepartmentSelect';
import { PRIORITIES, PRIORITY_COLORS, fmtSize } from './constants';

const MAX_BYTES = 10 * 1024 * 1024;
const OTHER = 'other';

/**
 * Composer for a new memo, and the edit view for one that came back rejected.
 * `editing` is the full correspondence record when re-submitting; null when new.
 *
 * The sending department is never a dropdown — it is always the signed-in
 * user's own department, shown as a static chip in the route strip, exactly as
 * the brief requires.
 */
export default function NewCorrespondence({ editing = null, onDone, onCancel }) {
  const { t } = useLang();
  const c = t.corr;

  const [depts, setDepts]   = useState([]);
  const [fromDept, setFrom] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [approver, setApprover]   = useState({ head: null, deputy: null });
  const [noDept, setNoDept] = useState(false);
  const [loading, setLoad]  = useState(true);

  const [toDept, setToDept]   = useState(editing?.to_dept_id || '');
  const [service, setService] = useState(editing?.service_id || '');
  const [subject, setSubject] = useState(
    editing && editing.service_id === OTHER ? editing.subject : ''
  );
  const [priority, setPriority] = useState(editing?.priority || 'med');
  const [body, setBody] = useState(editing?.body || '');
  const [files, setFiles] = useState([]);
  const [dragging, setDrag] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    getRequestableDepartments()
      .then(r => {
        setDepts(r.departments || []);
        setFrom(r.fromDeptId || '');
        setFromLabel(r.fromDeptLabel || '');
        setApprover(r.approver || { head: null, deputy: null });
        setNoDept(!!r.noDepartment);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, []);

  const selectedDept = depts.find(d => d.id === toDept);
  const services = selectedDept?.services || [];
  const isOther  = service === OTHER;

  // Changing the receiving department invalidates whichever request type was
  // picked — the catalogue is per-department.
  function pickDept(id) {
    setToDept(id);
    setService('');
    setSubject('');
  }

  const addFiles = useCallback(list => {
    const incoming = Array.from(list || []);
    setErr('');
    setFiles(prev => {
      const next = [...prev];
      for (const f of incoming) {
        if (f.size > MAX_BYTES) { setErr(c.tooBig.replace('{name}', f.name)); continue; }
        if (next.some(x => x.name === f.name)) { setErr(c.dupFile.replace('{name}', f.name)); continue; }
        next.push(f);
      }
      return next;
    });
  }, [c]);

  // Drop anywhere on the card, not just on the small button — a big invisible
  // target beats a big visible box that pushes the form around.
  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    addFiles(e.dataTransfer?.files);
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!toDept)                    return setErr(c.errToDept);
    if (!service)                   return setErr(c.errType);
    if (isOther && !subject.trim()) return setErr(c.errSubject);
    if (!body.trim())               return setErr(c.errBody);

    setBusy(true);
    try {
      const payload = {
        to_dept_id: toDept,
        service_id: service,
        subject: isOther ? subject.trim() : '',
        body: body.trim(),
        priority,
        files,
      };
      if (editing) await updateCorrespondence(editing.id, payload);
      else         await createCorrespondence(payload);
      onDone?.(editing ? c.resubmitted : c.sentToHead);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  if (noDept) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={32} strokeWidth={1.5} /></div>
        <div className="empty-title">{c.noDeptTitle}</div>
        <div className="empty-sub">{c.noDeptBody}</div>
      </div>
    );
  }

  // The approver is now an object with presence, not just a name.
  const who = approver.head || approver.deputy;
  const approverName = who?.name || null;
  const roleWord = approver.head ? c.headRole : c.deputyRole;

  let presence = null;
  if (who) {
    if (!who.has_account)   presence = c.approverNoAccount;
    else if (who.online)    presence = c.approverOnline;
    else if (who.last_seen_at) presence = c.approverAway.replace('{when}', String(who.last_seen_at).slice(0, 16));
  }

  return (
    <form
      className={`card corr-compose${dragging ? ' dragging' : ''}`}
      onSubmit={submit}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={onDrop}>

      <div className="card-header">
        <div>
          <h2 className="card-title">{editing ? c.editReturnedTitle : c.newTitle}</h2>
          <div className="card-subtitle">{c.newSubtitle}</div>
        </div>
      </div>

      <div className="card-body">
        {editing && (
          <div className="alert alert-warning corr-editing-notice">
            <AlertTriangle size={15} strokeWidth={2} />
            <div>
              <div style={{ fontWeight: 700 }}>{c.editingNotice}</div>
              {editing.rejection_reason && (
                <div className="corr-editing-reason">
                  <strong>{c.rejectReason}:</strong> {editing.rejection_reason}
                </div>
              )}
            </div>
          </div>
        )}

        {err && <div className="alert alert-error">{err}</div>}

        {/* Route strip — a memo is fundamentally "from here, to there". */}
        <div className="corr-route">
          <div className="corr-route-side">
            <span className="corr-route-label">{c.fromDept}</span>
            {/* fromLabel comes from the API; groupLabels is the fallback for
                when the server hasn't been restarted since that field was
                added. Never show the raw id. */}
            <span className="corr-route-fixed">
              {fromLabel || t.groupLabels?.[fromDept] || fromDept}
            </span>
          </div>

          <ArrowLeft className="corr-route-arrow" size={18} strokeWidth={2} aria-hidden />

          <div className="corr-route-side">
            <span className="corr-route-label">{c.toDept} <span className="req">*</span></span>
            <DepartmentSelect
              departments={depts}
              value={toDept}
              onChange={pickDept}
              t={t}
              required
              placeholder={c.choose} />
          </div>
        </div>

        <div className="corr-fields">
          <div className="form-group">
            <label className="form-label">{c.requestType} <span className="req">*</span></label>
            <select
              className="form-control"
              value={service}
              disabled={!toDept}
              onChange={e => { setService(e.target.value); if (e.target.value !== OTHER) setSubject(''); }}>
              <option value="">{toDept ? c.choose : c.pickDeptFirst}</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              <option value={OTHER}>{c.other}</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{c.priority}</label>
            <div className="corr-priority" role="radiogroup" aria-label={c.priority}>
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  className={`corr-priority-opt${priority === p ? ' active' : ''}`}
                  style={priority === p ? {
                    background: PRIORITY_COLORS[p].bg,
                    color: PRIORITY_COLORS[p].color,
                    borderColor: PRIORITY_COLORS[p].color,
                  } : undefined}
                  onClick={() => setPriority(p)}>
                  <span className="corr-priority-dot" style={{ background: PRIORITY_COLORS[p].color }} />
                  {c.priorities[p]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isOther && (
          <div className="form-group">
            <label className="form-label">{c.subject} <span className="req">*</span></label>
            <input
              className="form-control"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={c.subjectPlaceholder}
              maxLength={200}
              autoFocus />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{c.body} <span className="req">*</span></label>
          <textarea
            className="form-control corr-textarea"
            rows={9}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={c.bodyPlaceholder} />
          <div className="corr-charcount">{c.charCount.replace('{n}', body.length)}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{c.attachments}</label>

          <div
            className={`corr-drop${dragging ? ' dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            aria-label={c.dropHint}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }}>
            <span className="corr-drop-icon"><Upload size={22} strokeWidth={1.8} /></span>
            <span className="corr-drop-title">{c.dropHint}</span>
            <span className="corr-drop-sub">{c.dropLimit}</span>
            <span className="btn btn-secondary btn-sm corr-drop-btn">
              <Plus size={13} strokeWidth={2.4} /> {c.addFiles}
            </span>
          </div>

          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />

          {!!files.length && (
            <div className="corr-chips">
              {files.map((f, i) => (
                <span className="corr-chip" key={`${f.name}-${i}`}>
                  <FileText size={13} strokeWidth={2} />
                  <span className="corr-chip-name">{f.name}</span>
                  <span className="corr-chip-size">{fmtSize(f.size)}</span>
                  <button
                    type="button"
                    className="corr-chip-x"
                    aria-label={c.removeFile}
                    onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {!!editing?.attachments?.length && (
            <div className="corr-attach-hint" style={{ marginTop: '0.5rem' }}>
              {c.existingAttachments.replace('{n}', editing.attachments.length)}
            </div>
          )}
        </div>
      </div>

      {/* Who signs this off, stated before you commit to sending it. */}
      <div className="corr-compose-foot">
        <div className={`corr-approver${approverName ? '' : ' warn'}`}>
          {approverName ? <ShieldCheck size={15} strokeWidth={2} /> : <AlertTriangle size={15} strokeWidth={2} />}
          <span>
            {approverName
              ? c.willBeSentTo.replace('{name}', `${approverName} — ${roleWord}`)
              : c.noApproverYet}
            {presence && <span className="corr-approver-presence">{presence}</span>}
            {who?.ext && (
              <a className="corr-approver-ext" href={`tel:${who.ext}`} title={t.directory.callExt}>
                <Phone size={11} strokeWidth={2.4} />{who.ext}
              </a>
            )}
          </span>
        </div>
        <div className="corr-compose-actions">
          {onCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              {t.cancel || 'إلغاء'}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Send size={15} strokeWidth={2} />
            {busy ? '…' : (editing ? c.resubmit : c.send)}
          </button>
        </div>
      </div>

      {dragging && (
        <div className="corr-dropveil">
          <Upload size={26} strokeWidth={1.6} />
          <div>{c.dropHint}</div>
        </div>
      )}
    </form>
  );
}
