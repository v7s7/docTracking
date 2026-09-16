import React, { useState, useRef, useEffect } from 'react';
import { Upload, Plus, FileText, X } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { useToast } from '../common/Toast';
import { fmtSize } from '../correspondence/constants';
import { publishCircular, updateCircular } from '../../services/circularService';
import { getDepartments } from '../../services/deptService';

// Compose / correct a تعميم. `source` is fixed by the screen it opens from, so
// there is no picker — a person who may sign for both offices reaches each one
// through its own sidebar entry, and a تعميم can never be filed under the wrong
// office by mistake.
export default function NewCircular({ source, editing, onClose, onSaved }) {
  const { t } = useLang();
  const toast = useToast();
  const c = t.circulars;

  const [title, setTitle] = useState(editing?.title || '');
  const [body, setBody]   = useState(editing?.body || '');
  const [files, setFiles] = useState([]);
  const [dragging, setDrag] = useState(false);
  const [busy, setBusy]   = useState(false);
  const fileInput = useRef(null);

  // URD 6.7: «موجّه لجميع المستخدمين أو لأقسام محددة».
  //
  // Empty set == everyone, which is both the default and what every تعميم
  // published before targeting existed already is. That equivalence is why
  // there is no separate "send to all" toggle to get out of sync with the list:
  // choosing nothing IS choosing everyone, and the hint below says so.
  const [depts, setDepts]     = useState([]);
  const [targets, setTargets] = useState(() => new Set(editing?.target_depts_list || []));
  useEffect(() => { getDepartments().then(list => setDepts(list || [])).catch(() => {}); }, []);

  const toggleDept = id => setTargets(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const addFiles = list => setFiles(prev => [...prev, ...Array.from(list || [])]);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error(c.titleAndBodyRequired);
      return;
    }
    setBusy(true);
    try {
      const targetDepts = [...targets];
      if (editing) {
        await updateCircular(editing.id, { title, body, files, targetDepts });
        toast.success(c.saved);
      } else {
        await publishCircular({ source, title, body, files, targetDepts });
        toast.success(c.published);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-lg corr-compose" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>
            {editing ? c.editCircular : c.newCircular}
            {'  —  '}
            {c[source === 'deputy_chairman' ? 'deputy' : 'director']}
          </h3>
          <button className="modal-close" onClick={onClose} aria-label={t.close || 'إغلاق'}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label" htmlFor="circ-title">{c.titleField}</label>
              <input
                id="circ-title"
                className="form-control"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={c.titlePlaceholder}
                maxLength={200}
                autoFocus />
            </div>

            <div className="form-group">
              <label className="form-label">{c.audienceField}</label>
              <div className="circ-audience">
                <button
                  type="button"
                  className={`corr-filter${targets.size === 0 ? ' active' : ''}`}
                  onClick={() => setTargets(new Set())}>
                  {c.audienceAll}
                </button>
                {depts.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={`corr-filter${targets.has(d.id) ? ' active' : ''}`}
                    aria-pressed={targets.has(d.id)}
                    onClick={() => toggleDept(d.id)}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="form-hint">
                {targets.size === 0
                  ? c.audienceHintAll
                  : c.audienceHintSome.replace('{n}', targets.size)}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="circ-body">{c.bodyField}</label>
              <textarea
                id="circ-body"
                className="form-control"
                rows={10}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={c.bodyPlaceholder} />
            </div>

            <div
              className={`corr-drop${dragging ? ' dragging' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              role="button"
              tabIndex={0}
              aria-label={t.corr.dropHint}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }}>
              <span className="corr-drop-icon"><Upload size={22} strokeWidth={1.8} /></span>
              <span className="corr-drop-title">{t.corr.dropHint}</span>
              <span className="corr-drop-sub">{t.corr.dropLimit}</span>
              <span className="btn btn-secondary btn-sm corr-drop-btn">
                <Plus size={13} strokeWidth={2.4} /> {t.corr.addFiles}
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
                      aria-label={t.corr.removeFile}
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

            {!editing && <div className="alert alert-info" style={{ marginTop: '1rem' }}>{c.publishWarning}</div>}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>
              {t.cancel || 'إلغاء'}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? (t.saving || '…') : editing ? c.save : c.publish}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
