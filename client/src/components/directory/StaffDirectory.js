import React, { useState, useEffect, useMemo } from 'react';
import { Search, Phone, Smartphone, MessageCircle, Mail, Users } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { getStaffDirectory } from '../../services/directoryService';

// دليل الهاتف — the extension lookup everyone does several times a day.
// Search matches name, department, username AND extension, so typing "5022"
// finds the person as readily as typing their name.
export default function StaffDirectory({ onChat, onCompose }) {
  const { t } = useLang();
  const d = t.directory;

  const [users, setUsers]   = useState([]);
  const [deptLines, setLines] = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState('');
  const [q, setQ]           = useState('');
  const [dept, setDept]     = useState('');

  useEffect(() => {
    getStaffDirectory()
      .then(r => { setUsers(r.users || []); setLines(r.deptLines || []); })
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, []);

  const departments = useMemo(() => {
    const seen = new Map();
    users.forEach(u => { if (u.dept_id && !seen.has(u.dept_id)) seen.set(u.dept_id, u.dept_label); });
    return [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ar'));
  }, [users]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(u => {
      if (dept && u.dept_id !== dept) return false;
      if (!needle) return true;
      return [u.full_name, u.dept_label, u.username, u.ext, u.mobile, u.email]
        .some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [users, q, dept]);

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{d.title}</h2>
          <div className="card-subtitle">
            {d.count.replace('{n}', users.length)}
            {shown.length !== users.length && ` · ${d.showing.replace('{n}', shown.length)}`}
          </div>
        </div>
        <div className="corr-search">
          <Search size={15} strokeWidth={2} />
          <input
            className="form-control form-control-sm"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={d.searchPlaceholder} />
        </div>
      </div>

      <div className="corr-chiprow">
        <button className={`corr-filter${dept === '' ? ' active' : ''}`} onClick={() => setDept('')}>
          {t.corr.all}
        </button>
        {departments.map(([id, label]) => (
          <button key={id} className={`corr-filter${dept === id ? ' active' : ''}`} onClick={() => setDept(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card-body">
        {err && <div className="alert alert-error">{err}</div>}

        {/* Department-owned lines, shown when that department is in view. */}
        {deptLines
          .filter(dl => !dept || dl.id === dept)
          .filter(dl => !q.trim() || dl.phones.some(x => x.number.includes(q.trim())) || dl.label.includes(q.trim()))
          .map(dl => (
            <div className="dir-deptlines" key={dl.id}>
              <span className="dir-deptlines-label">{d.deptLines.replace('{dept}', dl.label)}</span>
              {dl.phones.map(x => (
                <a key={x.number} className="dir-ext" href={`tel:${x.number}`}>
                  <Phone size={12} strokeWidth={2.2} /><span>{x.number}</span>
                </a>
              ))}
            </div>
          ))}

        {!shown.length ? (
          <div className="empty-state">
            <div className="empty-icon"><Users size={30} strokeWidth={1.5} /></div>
            <div className="empty-sub">{t.noResults || d.none}</div>
          </div>
        ) : (
          <div className="dir-grid">
            {shown.map(u => {
              const initials = String(u.full_name || u.username || '?')
                .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
              return (
                <div className="dir-card" key={u.id}>
                  <div className="dir-top">
                    <div
                      className="dir-avatar"
                      style={u.avatar_color && !u.avatar_url ? { background: u.avatar_color } : undefined}>
                      {u.avatar_url ? <img src={u.avatar_url} alt="" /> : initials}
                      {u.online && <span className="dir-dot" title={d.online} />}
                    </div>
                    <div className="dir-id">
                      <div className="dir-name">
                        {u.full_name}
                        {u.is_self && <span className="dir-you">{d.you}</span>}
                      </div>
                      <div className="dir-sub">{u.dept_label || '—'}</div>
                      {u.status_text && <div className="dir-status">{u.status_text}</div>}
                    </div>
                    {u.ext && (
                      // The reason this page exists — big, monospace, copyable.
                      <a className="dir-ext" href={`tel:${u.ext}`} title={d.callExt}>
                        <Phone size={12} strokeWidth={2.2} />
                        <span>{u.ext}</span>
                      </a>
                    )}
                  </div>

                  <div className="dir-actions">
                    {u.mobile && (
                      <a className="btn btn-ghost btn-sm" href={`tel:${String(u.mobile).replace(/\s/g, '')}`}>
                        <Smartphone size={13} strokeWidth={2} />
                        <span dir="ltr">{u.mobile}</span>
                      </a>
                    )}
                    {u.email && (
                      <a className="btn btn-ghost btn-sm" href={`mailto:${u.email}`} title={u.email}>
                        <Mail size={13} strokeWidth={2} />
                      </a>
                    )}
                    {!u.is_self && (
                      <button className="btn btn-secondary btn-sm" onClick={() => onChat?.(u)}>
                        <MessageCircle size={13} strokeWidth={2} /> {d.message}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
