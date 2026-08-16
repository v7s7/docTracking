import React, { useState, useEffect, useMemo } from 'react';
import { Search, Phone, MessageCircle, Users, X } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { getStaffDirectory } from '../../services/directoryService';

// دليل الهاتف — the extension lookup everyone does several times a day.
//
// A table, not cards: the whole job is "find one row, read the number off it",
// and a table puts every extension in the same column so the eye runs straight
// down it. Cards make you hunt for the number in a different place on each one.
//
// Search matches name, department, username, email AND extension, so typing
// "5022" finds the person as readily as typing their name.
export default function StaffDirectory({ onChat }) {
  const { t } = useLang();
  const d = t.directory;

  const [users, setUsers]     = useState([]);
  const [deptLines, setLines] = useState([]);
  const [loading, setLoad]    = useState(true);
  const [err, setErr]         = useState('');
  const [q, setQ]             = useState('');
  const [dept, setDept]       = useState('');

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
    return users
      .filter(u => {
        if (dept && u.dept_id !== dept) return false;
        if (!needle) return true;
        return [u.full_name, u.dept_label, u.username, u.ext, u.mobile, u.email, u.alt_email]
          .some(v => String(v || '').toLowerCase().includes(needle));
      })
      // Grouped by department, then alphabetical inside it — the order people
      // already have in their heads when they go looking for someone.
      .sort((a, b) =>
        String(a.dept_label || '').localeCompare(String(b.dept_label || ''), 'ar')
        || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar'));
  }, [users, q, dept]);

  // A department's own lines are not a person, but they are still something you
  // come here to look up — so they belong in the table, filed under their
  // department, rather than in a banner above it that you scroll past every time.
  const lines = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deptLines
      .filter(dl => !dept || dl.id === dept)
      .filter(dl => !needle
        || dl.phones.some(x => String(x.number).includes(needle))
        || String(dl.label).toLowerCase().includes(needle));
  }, [deptLines, dept, q]);

  // Interleaved so a department's lines sit with its people, not in a block of
  // their own at one end of the table.
  const rows = useMemo(() => {
    const out = [];
    let i = 0;
    for (const p of shown) {
      while (i < lines.length
        && String(lines[i].label).localeCompare(String(p.dept_label || ''), 'ar') < 0) {
        out.push({ line: lines[i++] });
      }
      out.push({ person: p });
    }
    while (i < lines.length) out.push({ line: lines[i++] });
    return out;
  }, [shown, lines]);

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
          {q && (
            <button className="dir-clear" onClick={() => setQ('')} aria-label={t.corr.all}>
              <X size={13} strokeWidth={2.4} />
            </button>
          )}
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

        {!rows.length ? (
          <div className="empty-state">
            <div className="empty-icon"><Users size={30} strokeWidth={1.5} /></div>
            <div className="empty-sub">{t.noResults || d.none}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="dir-table">
              <thead>
                <tr>
                  <th>{t.fullName}</th>
                  <th>{t.dept}</th>
                  <th className="dir-th-ext">{d.ext}</th>
                  <th>{d.mobile}</th>
                  <th>{t.email}</th>
                  <th>{d.altEmail}</th>
                  <th className="dir-td-action" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => r.line ? (
                  <tr key={`line-${r.line.id}`} className="dir-linerow">
                    <td>
                      <div className="dir-cell-name">
                        <span className="dir-avatar dir-avatar-sm dir-avatar-line">
                          <Phone size={13} strokeWidth={2.2} />
                        </span>
                        <span className="dir-name">{d.deptLine}</span>
                      </div>
                    </td>
                    <td className="text-muted">{r.line.label}</td>
                    <td colSpan={4}>
                      <span className="dir-lines">
                        {r.line.phones.map(x => (
                          <a key={x.number} className="dir-ext" href={`tel:${x.number}`}>
                            <Phone size={12} strokeWidth={2.2} /><span>{x.number}</span>
                          </a>
                        ))}
                      </span>
                    </td>
                    <td className="dir-td-action" />
                  </tr>
                ) : (() => { const u = r.person; return (
                  <tr key={u.id}>
                    <td>
                      <div className="dir-cell-name">
                        <span
                          className="dir-avatar dir-avatar-sm"
                          style={u.avatar_color && !u.avatar_url ? { background: u.avatar_color } : undefined}>
                          {u.avatar_url
                            ? <img src={u.avatar_url} alt="" />
                            : String(u.full_name || u.username || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                          {u.online && <span className="dir-dot" title={d.online} />}
                        </span>
                        <span>
                          <span className="dir-name">{u.full_name}</span>
                          {u.is_self && <span className="dir-you">{d.you}</span>}
                          {u.status_text && <span className="dir-status">{u.status_text}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="text-muted">{u.dept_label || '—'}</td>
                    <td>
                      {/* The reason this page exists — one column, always the
                          same place, tabular figures so the digits line up. */}
                      {u.ext
                        ? <a className="dir-ext" href={`tel:${u.ext}`} title={d.callExt}>
                            <Phone size={12} strokeWidth={2.2} /><span>{u.ext}</span>
                          </a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {u.mobile
                        ? <a className="dir-plain" href={`tel:${String(u.mobile).replace(/\s/g, '')}`} dir="ltr">{u.mobile}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {u.email
                        ? <a className="dir-plain dir-email" href={`mailto:${u.email}`} dir="ltr" title={u.email}>{u.email}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {/* A second work address — several people correspond from a
                          personal mailbox as well as their @swd.bh one. */}
                      {u.alt_email
                        ? <a className="dir-plain dir-email" href={`mailto:${u.alt_email}`} dir="ltr" title={u.alt_email}>{u.alt_email}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="dir-td-action">
                      {!u.is_self && (
                        <button className="btn btn-ghost btn-sm" onClick={() => onChat?.(u)} title={d.message}>
                          <MessageCircle size={14} strokeWidth={2} />
                        </button>
                      )}
                    </td>
                  </tr>
                ); })())}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
