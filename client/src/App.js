import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LangProvider, useLang } from './context/LangContext';
import {
  LayoutDashboard, ClipboardList, Users, Settings, LogOut, Lock, Building2, MessageCircle,
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
import { getUnreadCount, getConversations, sendPresence } from './services/messageService';

const PRESENCE_MS = 60_000;
const MSG_POLL_MS = 20_000;

// ── Role helpers ─────────────────────────────────────────────
function isCS(role)      { return ['SUPER_ADMIN', 'ADMIN', 'CUSTOMER_SERVICE'].includes(role); }
function isSuperAdmin(r) { return r === 'SUPER_ADMIN'; }

// ── Nav items per role ───────────────────────────────────────
function navItems(role, t, hasMessages) {
  const items = [
    { id: 'dashboard', icon: <LayoutDashboard size={17} strokeWidth={1.8} />, label: t.dashboard },
    { id: 'tasks',     icon: <ClipboardList   size={17} strokeWidth={1.8} />, label: t.tasks },
  ];
  if (hasMessages) items.push({ id: 'messages', icon: <MessageCircle size={17} strokeWidth={1.8} />, label: t.messages });
  if (isSuperAdmin(role)) items.push({ id: 'users',    icon: <Users    size={17} strokeWidth={1.8} />, label: t.users });
  if (isSuperAdmin(role)) items.push({ id: 'settings', icon: <Settings size={17} strokeWidth={1.8} />, label: t.settings });
  return items;
}

// ── Header ───────────────────────────────────────────────────
function Header({ user, onTaskClick }) {
  const { logout } = useAuth();
  const { t, lang, toggle } = useLang();

  const initials = (user?.name || user?.username || '?')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">
          <Building2 size={18} strokeWidth={1.6} />
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
        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{user?.name || user?.username}</div>
            <span className="user-role-badge">{t.roles?.[user?.role] || user?.role}</span>
          </div>
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
  const items = navItems(user?.role, t, !!user?.id);

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
  const [view, setView]   = useState('dashboard');
  const [taskId, setTaskId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refresh, setRefresh]       = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const lastSeenMsgRef = useRef({});
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => { if (user) getDepartments().catch(() => {}); }, [user]);

  const handleNavAndClearTask = useCallback((v) => {
    setView(v);
    setTaskId(null);
  }, []);

  // Presence heartbeat — keeps "last seen" fresh while the app is open
  useEffect(() => {
    if (!user?.id) return;
    const ping = () => sendPresence().catch(() => {});
    ping();
    const id = setInterval(ping, PRESENCE_MS);
    window.addEventListener('focus', ping);
    return () => { clearInterval(id); window.removeEventListener('focus', ping); };
  }, [user?.id]);

  // Unread message badge + desktop notifications for new messages
  useEffect(() => {
    if (!user?.id) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    let cancelled = false;
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
            const notif = new Notification(title, { body: last.content || last.file_name || '', icon: '/favicon.ico' });
            notif.onclick = () => { window.focus(); setView('messages'); setTaskId(null); };
          }
        }
      } catch (_) {}
    }

    poll();
    const id = setInterval(poll, MSG_POLL_MS);
    window.addEventListener('focus', poll);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('focus', poll); };
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
