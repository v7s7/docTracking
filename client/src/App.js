import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LangProvider, useLang } from './context/LangContext';
import {
  LayoutDashboard, ClipboardList, Users, Settings, LogOut, Lock, MessageCircle, Camera, Trash2, Download,
  Mail, PenSquare, Inbox, CheckCircle2, RotateCcw, Archive, ChevronDown, ChevronLeft, BookUser, BarChart3,
  Megaphone,
} from 'lucide-react';
import { exportTasks } from './services/taskService';
import LoginPage from './components/auth/LoginPage';
import SuperAdminPanel from './components/admin/SuperAdminPanel';
import HomeDashboard from './components/dashboard/HomeDashboard';
import { ToastProvider, useToast } from './components/common/Toast';
import TaskDetail from './components/tasks/TaskDetail';
import UserManagement from './components/users/UserManagement';
import NotificationBell from './components/notifications/NotificationBell';
import Messages from './components/messages/Messages';
import CorrespondenceList from './components/correspondence/CorrespondenceList';
import NewCorrespondence from './components/correspondence/NewCorrespondence';
import { getCorrStats } from './services/correspondenceService';
import StaffDirectory from './components/directory/StaffDirectory';
import Reports from './components/reports/Reports';
import CircularsList from './components/circulars/CircularsList';
import { getCircStats } from './services/circularService';
import { getDepartments } from './services/deptService';
import { getUnreadCount, getConversations, sendPresence, getStatusText, setStatusText, fileUrl } from './services/messageService';
import { uploadAvatar, setAvatarColor, removeAvatar } from './services/userService';

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#9333ea', '#475569'];

const PRESENCE_MS      = 60_000;
const MSG_POLL_MS      = 20_000;
const AWAY_IDLE_SECONDS = 5 * 60;
const NOTIF_BATCH_MS   = 5 * 60_000;
const CIRC_POLL_MS     = 60_000;

// True when running inside the docTracking desktop app (see /desktop).
const isElectron = typeof window !== 'undefined' && !!window.electron?.isElectron;

// ── Role helpers ─────────────────────────────────────────────
function isSuperAdmin(r) { return r === 'SUPER_ADMIN'; }
// الموارد البشرية administers people too — roles, departments, joiners and
// leavers — so the users screen is theirs as well. What they may change once
// they are in it is decided server-side, in utils/permissions.js.
const HR_DEPT_ID = 'hr_dept';
function canManageUsers(u) { return isSuperAdmin(u?.role) || String(u?.dept_id || '') === HR_DEPT_ID; }

// The correspondence sub-menu. Ids double as view keys.
const CORR_VIEWS = ['corr-new', 'corr-inbox', 'corr-approvals', 'corr-returned', 'corr-archive', 'corr-reports'];

// التعاميم. Two entries, one screen — `source` is the only difference, and it
// doubles as the key into the unread counts returned by GET /circulars/stats.
const CIRC_VIEWS = {
  'circ-deputy':   'deputy_chairman',
  'circ-director': 'director_general',
};

function corrChildren(t) {
  const c = t.corr.nav;
  return [
    { id: 'corr-new',       icon: <PenSquare   size={17} strokeWidth={1.8} />, label: c.new },
    { id: 'corr-inbox',     icon: <Inbox       size={17} strokeWidth={1.8} />, label: c.inbox,     badge: 'inbox' },
    { id: 'corr-approvals', icon: <CheckCircle2 size={17} strokeWidth={1.8} />, label: c.approvals, badge: 'approvals' },
    { id: 'corr-returned',  icon: <RotateCcw   size={17} strokeWidth={1.8} />, label: c.returned,  badge: 'returned' },
    { id: 'corr-archive',   icon: <Archive     size={17} strokeWidth={1.8} />, label: c.archive },
    { id: 'corr-reports',   icon: <BarChart3   size={17} strokeWidth={1.8} />, label: t.reports.title },
  ];
}

// ── Nav items per role ───────────────────────────────────────
function navItems(user, t, hasMessages, chatOnly) {
  const role = user?.role;
  // The desktop app is chat-focused for now: show only Messages.
  // Correspondence is web-first while the desktop question is open — flip this
  // single flag to surface it there too.
  if (chatOnly && hasMessages) {
    return [{ id: 'messages', icon: <MessageCircle size={20} strokeWidth={1.8} />, label: t.messages }];
  }

  const items = [
    { id: 'dashboard', icon: <LayoutDashboard size={20} strokeWidth={1.8} />, label: t.dashboard },
    { id: 'corr',      icon: <Mail size={20} strokeWidth={1.8} />, label: t.corr.nav.correspondence, children: corrChildren(t) },
  ];
  items.push({ id: 'directory', icon: <BookUser size={20} strokeWidth={1.8} />, label: t.directory.title });
  if (hasMessages) items.push({ id: 'messages', icon: <MessageCircle size={20} strokeWidth={1.8} />, label: t.messages });
  if (canManageUsers(user)) items.push({ id: 'users',    icon: <Users    size={20} strokeWidth={1.8} />, label: t.users });
  if (isSuperAdmin(role)) items.push({ id: 'settings', icon: <Settings size={20} strokeWidth={1.8} />, label: t.settings });

  // التعاميم are organisation-wide, so every role gets both entries — reading is
  // open to all; only the signing office can publish, and that is enforced
  // server-side in utils/circularAuth.js. `dividerBefore` puts a gap above the
  // group so it reads as separate from the working screens rather than as one
  // more item on the end of the list.
  items.push({ id: 'circ-deputy',   icon: <Megaphone size={20} strokeWidth={1.8} />, label: t.circulars.deputy,   badge: 'deputy_chairman',  dividerBefore: true });
  items.push({ id: 'circ-director', icon: <Megaphone size={20} strokeWidth={1.8} />, label: t.circulars.director, badge: 'director_general' });
  return items;
}

function NavBadge({ n }) {
  if (!n) return null;
  return <span className="sidebar-badge">{n > 99 ? '99+' : n}</span>;
}

// ── Header ───────────────────────────────────────────────────
function Header({ user, onTaskClick, onCorrClick }) {
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
        <NotificationBell onTaskClick={onTaskClick} onCorrClick={onCorrClick} />
        <div style={{ position: 'relative' }}>
          <div className="user-chip" onClick={() => setShowStatusPopover(s => !s)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
            <div className="user-avatar" style={!user?.avatar_url && user?.avatar_color ? { background: user.avatar_color } : undefined}>
              {user?.avatar_url ? <img src={fileUrl(user.avatar_url)} alt="" /> : initials}
            </div>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{user?.name || user?.username}</div>
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
                  {avatarErr && <div className="alert alert-error" style={{ marginTop: '0.4rem', fontSize: 'var(--fs-xs)' }}>{avatarErr}</div>}
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
function Sidebar({ activeView, onNav, user, unreadMsgs, corrBadges, circBadges }) {
  const { t } = useLang();
  const items = navItems(user, t, !!user?.id, isElectron);
  const inCorr = CORR_VIEWS.includes(activeView);
  const [openGroup, setOpenGroup] = useState(inCorr);

  // Opening a correspondence screen from anywhere else (a dashboard row, a
  // "returned" card) should reveal the group rather than leave it collapsed.
  useEffect(() => { if (inCorr) setOpenGroup(true); }, [inCorr]);

  const totalCorr = (corrBadges?.approvals || 0) + (corrBadges?.returned || 0) + (corrBadges?.inbox || 0);

  return (
    <aside className="app-sidebar">
      {items.map(item => {
        if (item.children) {
          const expanded = openGroup;
          const Chevron  = expanded ? ChevronDown : ChevronLeft;
          return (
            <div key={item.id}>
              <div
                className={`sidebar-item${inCorr && !expanded ? ' active' : ''}`}
                style={{ paddingInlineStart: '1.25rem', gap: '0.7rem' }}
                onClick={() => setOpenGroup(v => !v)}
                role="button"
                aria-expanded={expanded}
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setOpenGroup(v => !v)}
              >
                <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {!expanded && <NavBadge n={totalCorr} />}
                <Chevron size={15} strokeWidth={2} style={{ opacity: 0.6, flexShrink: 0 }} />
              </div>

              {expanded && item.children.map(ch => (
                <div
                  key={ch.id}
                  className={`sidebar-item sidebar-subitem${activeView === ch.id ? ' active' : ''}`}
                  onClick={() => onNav(ch.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onNav(ch.id)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{ch.icon}</span>
                  <span style={{ flex: 1 }}>{ch.label}</span>
                  <NavBadge n={ch.badge ? corrBadges?.[ch.badge] : 0} />
                </div>
              ))}
            </div>
          );
        }

        return (
          <React.Fragment key={item.id}>
            {item.dividerBefore && <div className="sidebar-divider" />}
            <div
              className={`sidebar-item${activeView === item.id ? ' active' : ''}`}
              style={{ paddingInlineStart: '1.25rem', gap: '0.7rem' }}
              onClick={() => onNav(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onNav(item.id)}
            >
              <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === 'messages' && <NavBadge n={unreadMsgs} />}
              {item.badge && <NavBadge n={circBadges?.[item.badge]} />}
            </div>
          </React.Fragment>
        );
      })}
    </aside>
  );
}

// ── Authenticated shell ──────────────────────────────────────
function AppShell() {
  const { user, loading } = useAuth();
  const { t }             = useLang();
  const [view, setView]   = useState(() => (isElectron && user?.id) ? 'messages' : 'dashboard');
  const [taskId, setTaskId] = useState(null);
  // Bumped when a legacy task changes. Nothing re-reads it any more — the
  // dashboard it used to remount is now the correspondence board — but
  // TaskDetail (still reachable from the notification bell) expects the
  // callback, so the setter stays and the value is intentionally unused.
  const [, setRefresh]              = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  // Correspondence being edited after rejection — non-null puts the composer
  // into edit mode. Cleared whenever the user navigates away.
  const [editingCorr, setEditingCorr] = useState(null);
  const [corrBadges, setCorrBadges]   = useState({ inbox: 0, approvals: 0, returned: 0 });
  const [corrApprovable, setCorrApprovable] = useState([]);
  const [corrRefresh, setCorrRefresh] = useState(0);
  const [circBadges, setCircBadges]   = useState({ deputy_chairman: 0, director_general: 0 });
  // Set when another screen asks to open a specific conversation; Messages
  // reads it on mount and clears it.
  const [pendingConv, setPendingConv] = useState(null);
  const toast = useToast();
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
    setEditingCorr(null);   // leaving the composer abandons an in-progress edit
  }, []);

  // Sidebar badge counts. Refreshed on nav and after every mutation so the
  // Approvals count drops the moment something is approved.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getCorrStats()
      .then(r => {
        if (cancelled) return;
        setCorrBadges(r.badges || { inbox: 0, approvals: 0, returned: 0 });
        setCorrApprovable(r.canApproveFor || []);
      })
      .catch(() => { /* badges are cosmetic — never block the shell */ });
    return () => { cancelled = true; };
  }, [user?.id, view, corrRefresh]);

  // Unread تعاميم. Polled on a timer as well as on nav, because a تعميم is
  // published by another office — nothing the user does would refresh it, and a
  // count that only moves on navigation is how a تعميم gets missed.
  const loadCircBadges = useCallback(() => {
    getCircStats()
      .then(r => setCircBadges(r.unread || { deputy_chairman: 0, director_general: 0 }))
      .catch(() => { /* badges are cosmetic — never block the shell */ });
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    loadCircBadges();
    const id = setInterval(loadCircBadges, CIRC_POLL_MS);
    return () => clearInterval(id);
  }, [user?.id, view, loadCircBadges]);

  const openCorrEditor = useCallback(item => {
    setEditingCorr(item);
    setView('corr-new');
    setTaskId(null);
  }, []);

  const afterCorrSave = useCallback(msg => {
    setEditingCorr(null);
    if (msg) toast.success(msg);
    setCorrRefresh(n => n + 1);
    setView('dashboard');
  }, [toast]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <a className="skip-link" href="#main-content">{t.skipToContent}</a>
      <Header user={user} onTaskClick={id => { setView('tasks'); setTaskId(id); }} onCorrClick={() => handleNavAndClearTask('corr-approvals')} />

      <div style={{ display: 'flex', flex: 1, marginTop: 'var(--header-h)' }}>
        <Sidebar
          activeView={taskId ? 'tasks' : view}
          onNav={handleNavAndClearTask}
          user={user}
          unreadMsgs={unreadMsgs}
          corrBadges={corrBadges}
          circBadges={circBadges} />

        <main className="app-main" id="main-content" tabIndex={-1}>
          {taskId ? (
            <TaskDetail
              taskId={taskId}
              onBack={() => setTaskId(null)}
              onUpdate={() => setRefresh(r => r + 1)}
            />
          ) : view === 'dashboard' ? (
            <>
              <HomeDashboard
                onEdit={openCorrEditor}
                onDiscuss={id => { setPendingConv({ conversationId: id }); handleNavAndClearTask('messages'); }}
                onNavigate={handleNavAndClearTask}
                refreshKey={corrRefresh} />
            </>
          ) : view === 'corr-new' ? (
            <NewCorrespondence
              key={editingCorr?.id || 'new'}
              editing={editingCorr}
              onDone={afterCorrSave}
              onCancel={editingCorr ? () => handleNavAndClearTask('corr-returned') : undefined} />
          ) : view === 'corr-reports' ? (
            <Reports />
          ) : CORR_VIEWS.includes(view) ? (
            <CorrespondenceList
              box={view.replace('corr-', '')}
              canApproveFor={corrApprovable}
              onEdit={openCorrEditor}
              onDiscuss={id => { setPendingConv({ conversationId: id }); handleNavAndClearTask('messages'); }}
              refreshKey={corrRefresh} />
          ) : view === 'tasks' ? (
            <div className="empty-state">
              <div className="empty-icon"><ClipboardList size={32} strokeWidth={1.5} /></div>
              <div className="empty-sub">{t.comingSoon}</div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                onClick={() => exportTasks()}>
                <Download size={14} strokeWidth={2} />{t.exportCSV}
              </button>
            </div>
          ) : CIRC_VIEWS[view] ? (
            <CircularsList source={CIRC_VIEWS[view]} onBadgeChange={loadCircBadges} />
          ) : view === 'directory' ? (
            <StaffDirectory
              onChat={u => { setPendingConv({ userId: u.id }); handleNavAndClearTask('messages'); }}
              onCompose={() => handleNavAndClearTask('corr-new')} />
          ) : view === 'messages' && user.id ? (
            <Messages openConversation={pendingConv} onOpened={() => setPendingConv(null)} />
          ) : view === 'users' && canManageUsers(user) ? (
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
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}
