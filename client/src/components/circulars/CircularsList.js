import React, { useState, useEffect, useCallback } from 'react';
import { Search, Megaphone, Paperclip, Plus } from 'lucide-react';
import { useLang } from '../../context/LangContext';
import { useToast } from '../common/Toast';
import { fmtDate } from '../correspondence/constants';
import {
  listCirculars, getCircular, getCircStats, markCircularRead,
} from '../../services/circularService';
import CircularDetail from './CircularDetail';
import NewCircular from './NewCircular';

// One screen behind both sidebar entries. They differ only by `source`, so
// search, filters, attachments and read-tracking are written once — the same
// reasoning as CorrespondenceList serving all four correspondence boxes.
export default function CircularsList({ source, onBadgeChange }) {
  const { t, deptName } = useLang();
  const toast = useToast();
  const c = t.circulars;

  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [canPublish, setCanPublish] = useState([]);
  const [open, setOpen]     = useState(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoad(true); setErr('');
    listCirculars({
      source,
      ...(search ? { search } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(unreadOnly ? { unread: '1' } : {}),
    })
      .then(r => setItems(r.items || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoad(false));
  }, [source, search, from, to, unreadOnly]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  useEffect(() => {
    getCircStats().then(r => setCanPublish(r.canPublish || [])).catch(() => {});
  }, []);

  // Opening a تعميم IS the receipt. Done before the modal renders so the sidebar
  // badge drops immediately rather than on the next poll.
  async function openOne(id) {
    try {
      const wasUnread = items.find(i => i.id === id && !i.is_read);
      const { item } = await getCircular(id);
      setOpen(item);
      if (wasUnread) {
        await markCircularRead(id);
        setItems(prev => prev.map(i => (i.id === id ? { ...i, is_read: 1 } : i)));
        onBadgeChange?.();
      }
    } catch (e) { toast.error(e.message); }
  }

  const mayPublish = canPublish.includes(source);
  const label = c[source === 'deputy_chairman' ? 'deputy' : 'director'];

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">{label}</h2>
            <div className="card-subtitle">{c.hint}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="corr-search">
              <Search size={15} strokeWidth={2} />
              <input
                className="form-control form-control-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={c.searchPlaceholder} />
            </div>
            {mayPublish && (
              <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setComposing(true); }}>
                <Plus size={14} strokeWidth={2.4} /> {c.newCircular}
              </button>
            )}
          </div>
        </div>

        <div className="corr-chiprow" style={{ gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className={`corr-filter${!unreadOnly ? ' active' : ''}`}
            onClick={() => setUnreadOnly(false)}>{c.all}</button>
          <button
            className={`corr-filter${unreadOnly ? ' active' : ''}`}
            onClick={() => setUnreadOnly(true)}>{c.unreadOnly}</button>

          <span style={{ marginInlineStart: '.5rem', color: 'var(--text-3)' }}>{c.from}</span>
          <input type="date" className="form-control form-control-sm" value={from}
                 onChange={e => setFrom(e.target.value)} />
          <span style={{ color: 'var(--text-3)' }}>{c.to}</span>
          <input type="date" className="form-control form-control-sm" value={to}
                 onChange={e => setTo(e.target.value)} />
          {(from || to || search || unreadOnly) && (
            <button className="btn btn-ghost btn-sm"
                    onClick={() => { setFrom(''); setTo(''); setSearch(''); setUnreadOnly(false); }}>
              {c.clearFilters}
            </button>
          )}
        </div>

        <div className="card-body">
          {err && <div className="alert alert-error">{err}</div>}

          {loading ? (
            <div className="page-loading"><div className="spinner" /></div>
          ) : !items.length ? (
            <div className="empty-state">
              <div className="empty-icon"><Megaphone size={30} strokeWidth={1.5} /></div>
              <div className="empty-sub">{c.empty}</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{c.serial}</th>
                    <th>{c.title}</th>
                    <th>{c.publisher}</th>
                    <th>{c.date}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr
                      key={it.id}
                      onClick={() => openOne(it.id)}
                      style={{ cursor: 'pointer', fontWeight: it.is_read ? 400 : 700 }}>
                      <td><code className="tag">{it.serial}</code></td>
                      <td>
                        {it.title}
                        {!it.is_read && <span className="sidebar-badge" style={{ marginInlineStart: '.5rem' }}>{c.new}</span>}
                        {!!it.edited_at && <span className="tag" style={{ marginInlineStart: '.5rem' }}>{c.edited}</span>}
                      </td>
                      <td style={{ fontWeight: 400 }}>
                        {it.published_by_name}
                        {it.published_by_dept ? ` · ${deptName(it.published_by_dept)}` : ''}
                      </td>
                      <td style={{ fontWeight: 400 }}>{fmtDate(it.created_at)}</td>
                      <td style={{ fontWeight: 400 }}>
                        {!!it.attachment_count && (
                          <span className="corr-chip-size" title={c.attachments}>
                            <Paperclip size={13} strokeWidth={2} /> {it.attachment_count}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {open && (
        <CircularDetail
          item={open}
          onClose={() => setOpen(null)}
          onChanged={() => { load(); onBadgeChange?.(); }}
          onEdit={item => { setOpen(null); setEditing(item); setComposing(true); }} />
      )}

      {composing && (
        <NewCircular
          source={source}
          editing={editing}
          onClose={() => { setComposing(false); setEditing(null); }}
          onSaved={() => { load(); onBadgeChange?.(); }} />
      )}
    </>
  );
}
