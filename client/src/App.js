import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LangProvider, useLang } from './context/LangContext';
import {
  LayoutDashboard, ClipboardList, Users, Settings, LogOut, Lock, MessageCircle, Camera, Trash2,
} from 'lucide-react';
import LoginPage from './components/auth/LoginPage';
import SuperAdminPanel from './components/admin/SuperAdminPanel';
import Dashboard from './components/dashboard/Dashboard';
import TaskList from './components/tasks/TaskList';
import TaskDetail from './components/tasks/TaskDetail';
import CreateTaskModal from './components/tasks/CreateTaskModal';
import UserManagement from './components/users/UserManagement';
import NotificationBell from './components/notifications/NotificationBell';
import Messages from './components/messages/Messages';
import { getDepartments } from './services/deptService';
import { getUnreadCount, getConversations, sendPresence, getStatusText, setStatusText, fileUrl } from './services/messageService';
import { uploadAvatar, setAvatarColor, removeAvatar } from './services/userService';

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#9333ea', '#475569'];

const PRESENCE_MS      = 60_000;
const MSG_POLL_MS      = 20_000;
const AWAY_IDLE_SECONDS = 5 * 60;
const NOTIF_BATCH_MS   = 5 * 60_000;

// True when running inside the docTracking desktop app (see /desktop).
const isElectron = typeof window !== 'undefined' && !!window.electron?.isElectron;

// ── Role helpers ─────────────────────────────────────────────
function isCS(role)      { return ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role); }
function isSuperAdmin(r) { return r === 'SUPER_ADMIN'; }

// ── Nav items per role ───────────────────────────────────────
function navItems(role, t, hasMessages, chatOnly) {
  // The desktop app is chat-focused for now: show only Messages.
  // (Easy to revert — just stop passing chatOnly.)
  if (chatOnly && hasMessages) {
    return [{ id: 'messages', icon: <MessageCircle size={20} strokeWidth={1.8} />, label: t.messages }];
  }

  const items = [
    { id: 'dashboard', icon: <LayoutDashboard size={20} strokeWidth={1.8} />, label: t.dashboard },
    { id: 'tasks',     icon: <ClipboardList   size={20} strokeWidth={1.8} />, label: t.tasks },
  ];
  if (hasMessages) items.push({ id: 'messages', icon: <MessageCircle size={20} strokeWidth={1.8} />, label: t.messages });
  if (isSuperAdmin(role)) items.push({ id: 'users',    icon: <Users    size={20} strokeWidth={1.8} />, label: t.users });
  if (isSuperAdmin(role)) items.push({ id: 'settings', icon: <Settings size={20} strokeWidth={1.8} />, label: t.settings });
  return items;
}

// ── Header ───────────────────────────────────────────────────
function Header({ user, onTaskClick }) {
  const { logout, updateUser } = useAuth();
  const { t, lang, toggle } = useLang();
  const [statusText, setStatusTextState] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [showStatusPopover, setShowStatusPopover] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState('');
  const avatarFileInput = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    getStatusText().then(d => {
      setStatusTextState(d.statusText || '');
      setStatusInput(d.statusText || '');
    }).catch(() => {});
  }, [user?.id]);

  async function saveStatus(text) {
    try {
      const { statusText: saved } = await setStatusText(text);
      setStatusTextState(saved);
      setStatusInput(saved);
      setShowStatusPopover(false);
    } catch (_) {}
  }

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    setAvatarErr('');
    try {
      const { avatar_url } = await uploadAvatar(file);
      updateUser({ avatar_url });
    } catch (err) {
      setAvatarErr(err.message || 'Upload failed.');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handlePickColor(color) {
    setAvatarErr('');
    try {
      await setAvatarColor(color);
      updateUser({ avatar_color: color });
    } catch (err) {
      setAvatarErr(err.message || 'Failed to set color.');
    }
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true);
    setAvatarErr('');
    try {
      await removeAvatar();
      updateUser({ avatar_url: null });
    } catch (err) {
      setAvatarErr(err.message || 'Failed to remove picture.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const initials = (user?.name || user?.username || '?')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">
          <img src="/logo.png" alt="" className="header-logo-img" />
        </div>
        <div>
          <div className="header-title">{t.orgName}</div>
          <div className="header-subtitle">{t.appName}</div>
        </div>
      </div>
      <div className="header-actions">
        <div className="lang-toggle">
          <button className={`lang-btn${lang === 'ar' ? ' active' : ''}`} type="button"
            onClick={() => lang !== 'ar' && toggle()}>عربي</button>
          <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} type="button"
            onClick={() => lang !== 'en' && toggle()}>EN</button>
        </div>
        <NotificationBell onTaskClick={onTaskClick} />
        <div style={{ position: 'relative' }}>
          <div className="user-chip" onClick={() => setShowStatusPopover(s => !s)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
            <div className="user-avatar" style={!user?.avatar_url && user?.avatar_color ? { background: user.avatar_color } : undefined}>
              {user?.avatar_url ? <img src={fileUrl(user.avatar_url)} alt="" /> : initials}
            </div>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{user?.name || user?.username}</div>
              <span className="user-role-badge">{t.roles?.[user?.role] || user?.role}</span>
              {statusText && <span className="user-status-text">{statusText}</span>}
            </div>
          </div>
          {showStatusPopover && (
            <>
              <div className="msg-members-backdrop" onClick={() => setShowStatusPopover(false)} />
              <div className="status-popover" onClick={e => e.stopPropagation()}>
                <div className="status-popover-title">{t.setStatus}</div>
                <input
                  className="form-control"
                  value={statusInput}
                  onChange={e => setStatusInput(e.target.value)}
                  placeholder={t.statusPlaceholder}
                  maxLength={80}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveStatus(statusInput.trim());
                    if (e.key === 'Escape') setShowStatusPopover(false);
                  }}
                />
                <div className="status-popover-presets">
                  {(t.statusPresets || []).map(p => (
                    <button key={p} className="status-popover-preset" onClick={() => saveStatus(p)}>{p}</button>
                  ))}
                </div>
                <div className="status-popover-actions">
                  <button className="btn-ghost btn-sm" onClick={() => saveStatus('')}>{t.clearStatus}</button>
                  <button className="btn btn-primary btn-sm" onClick={() => saveStatus(statusInput.trim())}>{t.save}</button>
                </div>

                <div className="avatar-settings">
                  <div className="status-popover-title">{t.profilePicture}</div>
                  <input ref={avatarFileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }} onChange={handleAvatarFile} />
                  <div className="avatar-settings-row">
                    <button className="btn-ghost btn-sm" disabled={avatarBusy} onClick={() => avatarFileInput.current?.click()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Camera size={14} strokeWidth={2} />{t.uploadPicture}
                    </button>
                    {user?.avatar_url && (
                      <button className="btn-ghost btn-sm" disabled={avatarBusy} onClick={handleRemoveAvatar}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Trash2 size={14} strokeWidth={2} />{t.removePicture}
                      </button>
                    )}
                  </div>
                  <div className="status-popover-title" style={{ marginTop: '0.5rem' }}>{t.avatarColor}</div>
                  <div className="avatar-settings-row">
                    {AVATAR_COLORS.map(c => (
                      <button key={c} type="button"
                        className={`avatar-color-swatch${user?.avatar_color === c ? ' active' : ''}`}
                        style={{ background: c }}
                        onClick={() => handlePickColor(c)}
                        aria-label={c}
                      />
                    ))}
                  </div>
                  {avatarErr && <div className="alert alert-error" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>{avatarErr}</div>}
                </div>
              </div>
            </>
          )}
        </div>
        <button className="btn-header" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <LogOut size={14} strokeWidth={2} />{t.signOut}
        </button>
      </div>
    </header>
  );
}

// ── Sidebar ──────────────────────────────────────────────────
function Sidebar({ activeView, onNav, user, unreadMsgs }) {
  const { t } = useLang();
  const items = navItems(user?.role, t, !!user?.id, isElectron);

  return (
    <aside className="app-sidebar">
      {items.map(item => (
        <div
          key={item.id}
          className={`sidebar-item${activeView === item.id ? ' active' : ''}`}
          style={{ paddingInlineStart: '1.25rem', gap: '0.7rem' }}
          onClick={() => onNav(item.id)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNav(item.id)}
        >
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.id === 'messages' && unreadMsgs > 0 && (
            <span style={{
              background: 'var(--primary)', color: '#fff', borderRadius: 99,
              fontSize: '0.68rem', fontWeight: 700, minWidth: 18, height: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
            }}>
              {unreadMsgs > 99 ? '99+' : unreadMsgs}
            </span>
          )}
        </div>
      ))}
    </aside>
  );
}

// ── Authenticated shell ──────────────────────────────────────
function AppShell() {
  const { user, loading } = useAuth();
  const { t }             = useLang();
  const [view, setView]   = useState(() => (isElectron && user?.id) ? 'messages' : 'dashboard');
  const [taskId, setTaskId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refresh, setRefresh]       = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const lastSeenMsgRef = useRef({});
  const pendingNotifRef = useRef({});
  const notifBatchTimerRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastActivityRef = useRef(Date.now());

  useEffect(() => { if (user) getDepartments().catch(() => {}); }, [user]);

  const handleNavAndClearTask = useCallback((v) => {
    setView(v);
    setTaskId(null);
  }, []);

  // Track real user activity (mouse/keyboard/touch/focus) so browser tabs can
  // detect "away" the same way the desktop app does via OS idle time.
  useEffect(() => {
    if (!user?.id) return;
    const markActive = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'focus'];
    events.forEach(ev => window.addEventListener(ev, markActive, { passive: true }));
    return () => events.forEach(ev => window.removeEventListener(ev, markActive));
  }, [user?.id]);

  // Presence heartbeat — keeps "last seen" fresh while the app is open.
  // Reports 'away' once the user has gone AWAY_IDLE_SECONDS without any
  // mouse/keyboard input — via OS idle time in the desktop app, or via
  // tracked DOM activity in a plain browser tab.
  useEffect(() => {
    if (!user?.id) return;
    const ping = async () => {
      let status = 'active';
      if (isElectron && window.electron?.getIdleTime) {
        try {
          const idle = await window.electron.getIdleTime();
          if (idle >= AWAY_IDLE_SECONDS) status = 'away';
        } catch (_) {}
      } else if (Date.now() - lastActivityRef.current >= AWAY_IDLE_SECONDS * 1000) {
        status = 'away';
      }
      sendPresence(status).catch(() => {});
    };
    ping();
    const id = setInterval(ping, PRESENCE_MS);
    window.addEventListener('focus', ping);
    return () => { clearInterval(id); window.removeEventListener('focus', ping); };
  }, [user?.id]);

  // Unread message badge + desktop notifications for new messages.
  // Permission is requested from a real click (the bell-plus button in
  // NotificationBell) — browsers silently ignore requestPermission() calls
  // that aren't triggered by a user gesture, so asking here unconditionally
  // on mount never actually prompted most users.
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    // Fires once per burst, NOTIF_BATCH_MS after the first unseen message —
    // not reset by later arrivals — so a flurry of messages collapses into
    // one popup instead of one per message. Conversations the user already
    // read before the timer fires are dropped from pendingNotifRef (see
    // poll()) and so are left out of the summary, or skip it entirely if
    // everything pending got read in time.
    function fireBatch() {
      notifBatchTimerRef.current = null;
      const entries = Object.values(pendingNotifRef.current);
      pendingNotifRef.current = {};
      if (!entries.length) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (!document.hidden && viewRef.current === 'messages') return;

      let notif;
      if (entries.length === 1) {
        notif = new Notification(entries[0].title, { body: entries[0].body, icon: '/favicon.ico' });
      } else {
        const totalUnread = entries.reduce((sum, e) => sum + e.unread, 0);
        const body = (t.newMessagesBatch || '{n} new messages in {c} conversations')
          .replace('{n}', String(totalUnread)).replace('{c}', String(entries.length));
        notif = new Notification(t.notifTitle || 'Doc Tracking', { body, icon: '/favicon.ico' });
      }
      notif.onclick = () => { window.focus(); setView('messages'); setTaskId(null); };
    }

    async function poll() {
      try {
        const { unread } = await getUnreadCount();
        if (!cancelled) setUnreadMsgs(unread);
      } catch (_) {}

      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        const { conversations } = await getConversations();
        for (const conv of conversations) {
          const last = conv.last_message;
          if (!last) continue;
          const prevSeen = lastSeenMsgRef.current[conv.id];
          const isNew = prevSeen !== undefined && prevSeen !== last.created_at && last.sender_id !== user.id;
          lastSeenMsgRef.current[conv.id] = last.created_at;

          if (isNew && (document.hidden || viewRef.current !== 'messages')) {
            const title = conv.type === 'department' ? (t.groupLabels?.[conv.dept_id] || conv.name) : (last.sender_name || conv.name);
            const body = conv.unread > 1
              ? (t.newMessagesCount || '{n} new messages').replace('{n}', String(conv.unread))
              : (last.content || last.file_name || '');
            pendingNotifRef.current[conv.id] = { title, body, unread: conv.unread || 1 };
            if (notifBatchTimerRef.current === null) {
              notifBatchTimerRef.current = setTimeout(fireBatch, NOTIF_BATCH_MS);
            }
          } else if (!conv.unread) {
            delete pendingNotifRef.current[conv.id];
          }
        }
      } catch (_) {}
    }

    poll();
    const id = setInterval(poll, MSG_POLL_MS);
    window.addEventListener('focus', poll);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', poll);
      if (notifBatchTimerRef.current) { clearTimeout(notifBatchTimerRef.current); notifBatchTimerRef.current = null; }
    };
  }, [user?.id, t]);

  if (loading) return <div className="page-loading"><span className="spinner" /><span>{t.loading}</span></div>;
  if (!user)   return <LoginPage />;

  const canCreateTask = isCS(user.role);

  const createBtn = canCreateTask ? (
    <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
      + {t.createTask}
    </button>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header user={user} onTaskClick={id => { setView('tasks'); setTaskId(id); }} />

      <div style={{ display: 'flex', flex: 1, marginTop: 'var(--header-h)' }}>
        <Sidebar activeView={taskId ? 'tasks' : view} onNav={handleNavAndClearTask} user={user} unreadMsgs={unreadMsgs} />

        <main className="app-main">
          {taskId ? (
            <TaskDetail
              taskId={taskId}
              onBack={() => setTaskId(null)}
              onUpdate={() => setRefresh(r => r + 1)}
            />
          ) : view === 'dashboard' ? (
            <Dashboard onTaskClick={id => { setView('tasks'); setTaskId(id); }} key={refresh} />
          ) : view === 'tasks' ? (
            <TaskList
              key={refresh}
              onSelect={id => setTaskId(id)}
              createButton={createBtn}
            />
          ) : view === 'messages' && user.id ? (
            <Messages />
          ) : view === 'users' && isSuperAdmin(user.role) ? (
            <UserManagement />
          ) : view === 'settings' && isSuperAdmin(user.role) ? (
            <SuperAdminPanel />
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><Lock size={32} strokeWidth={1.5} /></div>
              <div className="empty-sub">Access denied.</div>
            </div>
          )}
        </main>
      </div>

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setRefresh(r => r + 1); setView('tasks'); }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </LangProvider>
  );
}
