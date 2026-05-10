import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { getNotifications, markAllRead, markOneRead } from '../../services/notificationService';
import { Bell, ArrowRight, RotateCcw } from 'lucide-react';

const POLL_MS = 30_000;

const TYPE_ICONS = {
  forwarded: <ArrowRight size={15} strokeWidth={1.8} />,
  returned:  <RotateCcw  size={15} strokeWidth={1.8} />,
};

export default function NotificationBell({ onTaskClick }) {
  const { t }                   = useLang();
  const [open, setOpen]         = useState(false);
  const [unread, setUnread]     = useState(0);
  const [items, setItems]       = useState([]);
  const panelRef                = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getNotifications();
      setUnread(data.unread);
      setItems(data.items);
    } catch (_) {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleMarkAll() {
    await markAllRead();
    setUnread(0);
    setItems(p => p.map(i => ({ ...i, is_read: 1 })));
  }

  async function handleClickItem(item) {
    if (!item.is_read) {
      await markOneRead(item.id);
      setItems(p => p.map(i => i.id === item.id ? { ...i, is_read: 1 } : i));
      setUnread(p => Math.max(0, p - 1));
    }
    setOpen(false);
    onTaskClick?.(item.task_id);
  }

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        className="btn-header"
        onClick={() => setOpen(p => !p)}
        style={{ position: 'relative', padding: '0.35rem 0.65rem', lineHeight: 1, display: 'flex', alignItems: 'center' }}
        aria-label={t.notifications || 'Notifications'}
      >
        <Bell size={17} strokeWidth={1.8} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, insetInlineEnd: -4,
            background: '#C53030', color: '#fff',
            borderRadius: '50%', width: 18, height: 18,
            fontSize: '0.62rem', fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--primary)',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          insetInlineEnd: 0,
          width: 340,
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
          zIndex: 600,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t.notifications || 'Notifications'}</span>
            {unread > 0 && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
                onClick={handleMarkAll}
              >
                {t.markAllRead || 'Mark all read'}
              </button>
            )}
          </div>

          {/* Items */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {!items.length ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-icon" style={{ fontSize: '1.5rem' }}>
                  <Bell size={28} strokeWidth={1.4} style={{ color: 'var(--text-3)' }} />
                </div>
                <div className="empty-sub">{t.noNotifications || 'No notifications yet.'}</div>
              </div>
            ) : items.map(item => (
              <div
                key={item.id}
                onClick={() => handleClickItem(item)}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: item.is_read ? 'var(--surface)' : 'var(--primary-light)',
                  display: 'flex',
                  gap: '0.65rem',
                  alignItems: 'flex-start',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{ color: item.is_read ? 'var(--text-3)' : 'var(--primary)', flexShrink: 0, marginTop: '0.1rem' }}>
                  {TYPE_ICONS[item.type] || <Bell size={15} strokeWidth={1.8} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: item.is_read ? 400 : 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.task_title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.15rem' }}>
                    <code className="tag" style={{ fontSize: '0.7em' }}>{item.task_serial}</code>
                    {' · '}
                    {item.created_at?.slice(0, 16)}
                  </div>
                </div>
                {!item.is_read && (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, marginTop: '0.35rem' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
