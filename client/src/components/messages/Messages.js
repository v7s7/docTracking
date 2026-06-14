import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import { useAuth } from '../../context/AuthContext';
import {
  getDirectory, getConversations, openDM, getMessages, sendMessage, markRead, fileUrl,
  getConversationMembers, streamUrl, startGroupChat, hideConversation, unhideConversation,
} from '../../services/messageService';
import {
  Send, Paperclip, Search, ArrowLeft, X, Download, MessageCircle, Building2, FileText, Plus, Users,
  Eye, EyeOff, ChevronDown, ChevronRight,
} from 'lucide-react';

const THREAD_POLL_MS = 4000;
const LIST_POLL_MS   = 15000;
const ONLINE_MS      = 2 * 60 * 1000;

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function toDate(dateStr) {
  return dateStr ? new Date(dateStr.replace(' ', 'T')) : null;
}

// "online" is true if the user has an open real-time connection right now
// (most reliable), or failing that, sent a presence heartbeat recently.
function isOnline(user) {
  if (!user) return false;
  if (user.online) return true;
  const d = toDate(user.last_seen_at);
  return !!d && (Date.now() - d.getTime()) < ONLINE_MS;
}

function isAway(user) {
  return isOnline(user) && user?.presence_status === 'away';
}

function relativeTime(dateStr, t) {
  const d = toDate(dateStr);
  if (!d) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1)   return t.justNow;
  if (mins < 60)  return (t.minAgo  || '{n}m').replace('{n}', mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return (t.hourAgo || '{n}h').replace('{n}', hrs);
  const days = Math.floor(hrs / 24);
  return (t.dayAgo || '{n}d').replace('{n}', days);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMsgTime(dateStr) {
  const d = toDate(dateStr);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function deptDisplayName(conv, t) {
  return t.groupLabels?.[conv.dept_id] || conv.name || conv.dept_id;
}

function Avatar({ name, isGroup, isDept, online, away }) {
  return (
    <div className={`msg-avatar${isGroup ? ' dept' : ''}`}>
      {isDept ? <Building2 size={18} strokeWidth={1.8} /> : isGroup ? <Users size={18} strokeWidth={1.8} /> : initials(name)}
      {online && <span className={`msg-online-dot${away ? ' away' : ''}`} />}
    </div>
  );
}

function ConversationItem({ conv, active, onClick, onToggleHide, t }) {
  const isDept  = conv.type === 'department';
  const isGroup = isDept || conv.type === 'group';
  const name = isDept ? deptDisplayName(conv, t) : (conv.name || '—');
  const online = !isGroup && isOnline(conv.other_user);
  const away   = !isGroup && isAway(conv.other_user);

  const last = conv.last_message;
  let snippet = '';
  if (last) {
    if (last.content) snippet = last.content;
    else if (last.file_name) snippet = `📎 ${last.file_name}`;
  }

  return (
    <div className={`msg-list-item${active ? ' active' : ''}`} onClick={onClick}>
      <Avatar name={name} isGroup={isGroup} isDept={isDept} online={online} away={away} />
      <div className="msg-list-item-body">
        <div className="msg-list-item-top">
          <span className="msg-list-item-name">{name}</span>
          {last && <span className="msg-list-item-time">{relativeTime(last.created_at, t)}</span>}
        </div>
        <div className="msg-list-item-preview">
          <span className="msg-list-item-snippet">{snippet || (t.noMessagesYet || '')}</span>
          {conv.unread > 0 && <span className="msg-unread-badge">{conv.unread > 99 ? '99+' : conv.unread}</span>}
        </div>
      </div>
      <button
        className={`msg-hide-btn btn-ghost btn-sm${conv.hidden ? ' always' : ''}`}
        onClick={e => { e.stopPropagation(); onToggleHide?.(conv); }}
        title={conv.hidden ? t.unhideChat : t.hideChat}
        aria-label={conv.hidden ? t.unhideChat : t.hideChat}
      >
        {conv.hidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
      </button>
    </div>
  );
}

function PersonItem({ person, onClick, t }) {
  return (
    <div className="msg-list-item" onClick={onClick}>
      <Avatar name={person.full_name} online={isOnline(person)} away={isAway(person)} />
      <div className="msg-list-item-body">
        <div className="msg-list-item-name">{person.full_name}</div>
        <div className="msg-list-item-snippet">{t.roles?.[person.role] || person.role}</div>
      </div>
    </div>
  );
}

function MemberItem({ member, t, isSelf, selected, onToggleSelect, onOpenChat }) {
  const online = isOnline(member);
  const away   = isAway(member);

  let status;
  if (away)               status = t.away;
  else if (online)        status = t.online;
  else if (member.last_seen_at) status = (t.lastSeen || '').replace('{time}', relativeTime(member.last_seen_at, t));
  else                    status = t.lastSeenNever;

  return (
    <div className="msg-list-item" onClick={() => !isSelf && onOpenChat?.(member)}>
      {!isSelf && (
        <input
          type="checkbox"
          className="msg-member-checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect?.(member.id)}
          onClick={e => e.stopPropagation()}
          aria-label={member.full_name}
        />
      )}
      <Avatar name={member.full_name} online={online} away={away} />
      <div className="msg-list-item-body">
        <div className="msg-list-item-name">{member.full_name}{isSelf ? ` (${t.you})` : ''}</div>
        <div className="msg-list-item-snippet">{status}</div>
      </div>
    </div>
  );
}

function MembersPanel({ members, t, currentUserId, onOpenChat, onStartGroup }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  const onlineCount = members.filter(m => isOnline(m)).length;

  const sorted = [...members].sort((a, b) => {
    const rank = m => isAway(m) ? 1 : isOnline(m) ? 0 : 2;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.full_name.localeCompare(b.full_name);
  });

  function toggle(id) {
    setError('');
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleStart() {
    setBusy(true);
    setError('');
    try {
      await onStartGroup?.([...selected]);
    } catch (e) {
      setError(e.message || 'Failed to start chat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="msg-members-panel">
      <div className="msg-members-panel-title">
        {t.members} · {(t.onlineNow || '{n}').replace('{n}', onlineCount)}
      </div>
      <div className="msg-members-panel-list">
        {sorted.map(m => (
          <MemberItem
            key={m.id}
            member={m}
            t={t}
            isSelf={m.id === currentUserId}
            selected={selected.has(m.id)}
            onToggleSelect={toggle}
            onOpenChat={onOpenChat}
          />
        ))}
      </div>
      {error && <div className="alert alert-error msg-members-panel-alert">{error}</div>}
      {selected.size > 0 && (
        <button className="btn btn-primary btn-sm msg-members-panel-action" onClick={handleStart} disabled={busy}>
          <MessageCircle size={14} strokeWidth={2} />
          {t.startChat} ({selected.size})
        </button>
      )}
    </div>
  );
}

function DirectoryPanel({ onPick, onClose, t }) {
  const [users, setUsers]   = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { getDirectory().then(d => setUsers(d.users || [])).catch(() => {}); }, []);

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MessageCircle size={15} strokeWidth={1.8} style={{ color: 'var(--primary)' }} />{t.newChat}
          </h3>
          <button className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="msg-search">
          <div style={{ position: 'relative' }}>
            <Search size={14} strokeWidth={2} style={{ position: 'absolute', top: '50%', insetInlineStart: '0.6rem', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
            <input
              className="form-control"
              style={{ padding: '0.45rem 0.7rem', paddingInlineStart: '2rem', fontSize: '0.85rem' }}
              placeholder={t.searchPeople}
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!filtered.length ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-sub">{t.noResults}</div>
            </div>
          ) : filtered.map(u => (
            <PersonItem key={u.id} person={u} onClick={() => onPick(u)} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, mine, showSender, t }) {
  const isImage = msg.file_type?.startsWith('image/');
  return (
    <div className={`msg-bubble-row ${mine ? 'mine' : 'theirs'}`}>
      {showSender && !mine && <span className="msg-sender-name">{msg.sender_name}</span>}
      <div className="msg-bubble">
        {msg.file_url && isImage && (
          <a href={fileUrl(msg.file_url)} target="_blank" rel="noopener noreferrer">
            <img src={fileUrl(msg.file_url)} alt={msg.file_name || ''} className="msg-image" />
          </a>
        )}
        {msg.file_url && !isImage && (
          <a className="msg-attachment" href={fileUrl(msg.file_url)} target="_blank" rel="noopener noreferrer" download={msg.file_name}>
            <FileText size={18} strokeWidth={1.8} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.file_name}</span>
            <span style={{ opacity: 0.7, flexShrink: 0 }}>{formatBytes(msg.file_size)}</span>
            <Download size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
          </a>
        )}
        {msg.content && <div style={{ marginTop: msg.file_url ? '0.4rem' : 0 }}>{msg.content}</div>}
      </div>
      <span className="msg-time">{formatMsgTime(msg.created_at)}</span>
    </div>
  );
}

function ChatThread({ conv, user, t, onBack, liveMessage, onOpenDM, onStartGroup }) {
  const [messages, setMessages]     = useState([]);
  const [text, setText]             = useState('');
  const [file, setFile]             = useState(null);
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState('');
  const [members, setMembers]       = useState([]);
  const [showMembers, setShowMembers] = useState(false);
  const bodyRef    = useRef(null);
  const fileInput  = useRef(null);
  const lastIdRef  = useRef(0);

  const isDept  = conv.type === 'department';
  const isGroup = isDept || conv.type === 'group';
  const name    = isDept ? deptDisplayName(conv, t) : (conv.name || '—');

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  const load = useCallback(async (reset) => {
    try {
      const data = await getMessages(conv.id, reset ? 0 : lastIdRef.current);
      if (data.messages?.length) {
        setMessages(prev => reset ? data.messages : [...prev, ...data.messages]);
        lastIdRef.current = data.messages[data.messages.length - 1].id;
        scrollToBottom();
      }
    } catch (_) {}
  }, [conv.id, scrollToBottom]);

  useEffect(() => {
    setMessages([]);
    lastIdRef.current = 0;
    load(true).then(scrollToBottom);
    const id = setInterval(() => load(false), THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [conv.id, load, scrollToBottom]);

  // Append messages pushed live over SSE for this conversation
  useEffect(() => {
    if (!liveMessage || liveMessage.conversation_id !== conv.id) return;
    const msg = liveMessage.message;
    if (msg.id <= lastIdRef.current) return;
    setMessages(prev => [...prev, msg]);
    lastIdRef.current = msg.id;
    scrollToBottom();
  }, [liveMessage, conv.id, scrollToBottom]);

  // Mark read whenever new messages arrive while the thread is open
  useEffect(() => {
    if (messages.length) markRead(conv.id).catch(() => {});
  }, [messages.length, conv.id]);

  // Department roster with live presence
  useEffect(() => {
    if (!isGroup) return;
    let cancelled = false;
    const loadMembers = () => getConversationMembers(conv.id).then(d => {
      if (!cancelled) setMembers(d.members || []);
    }).catch(() => {});
    loadMembers();
    const id = setInterval(loadMembers, LIST_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [conv.id, isGroup]);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (f && f.size > 15 * 1024 * 1024) {
      setError(t.fileTooLarge);
      e.target.value = '';
      return;
    }
    setError('');
    setFile(f || null);
  }

  async function handleSend() {
    const content = text.trim();
    if (!content && !file) return;
    setSending(true);
    setError('');
    try {
      await sendMessage(conv.id, { content, file });
      setText('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const online = !isGroup && isOnline(conv.other_user);
  const away   = !isGroup && isAway(conv.other_user);

  let status = '';
  if (isDept) {
    status = t.departmentGroup;
  } else if (isGroup) {
    status = t.groupChat;
  } else if (away) {
    status = t.away;
  } else if (online) {
    status = t.online;
  } else if (conv.other_user?.last_seen_at) {
    status = (t.lastSeen || '').replace('{time}', relativeTime(conv.other_user.last_seen_at, t));
  } else {
    status = t.lastSeenNever;
  }

  return (
    <div className="msg-thread">
      <div className="msg-thread-header">
        <button className="msg-back-btn btn-ghost btn-sm" onClick={onBack} aria-label="back">
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <Avatar name={name} isGroup={isGroup} isDept={isDept} online={online} away={away} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="msg-thread-title">{name}</div>
          <div className="msg-thread-status">{status}</div>
        </div>
        {isGroup && (
          <div style={{ position: 'relative' }}>
            <button className="btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => setShowMembers(s => !s)} title={t.members}>
              <Users size={16} strokeWidth={1.8} />
              <span style={{ fontSize: '0.8rem' }}>{members.length}</span>
            </button>
            {showMembers && (
              <>
                <div className="msg-members-backdrop" onClick={() => setShowMembers(false)} />
                <MembersPanel
                  members={members}
                  t={t}
                  currentUserId={user.id}
                  onOpenChat={member => { setShowMembers(false); onOpenDM?.(member); }}
                  onStartGroup={async memberIds => {
                    await onStartGroup?.(memberIds);
                    setShowMembers(false);
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="msg-body" ref={bodyRef}>
        {!messages.length ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="empty-icon"><MessageCircle size={28} strokeWidth={1.4} /></div>
            <div className="empty-sub">{t.noMessagesYet}</div>
          </div>
        ) : messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} mine={msg.sender_id === user.id} showSender={isGroup} t={t} />
        ))}
      </div>

      {error && (
        <div className="alert alert-error" style={{ margin: '0 1.1rem 0.5rem' }}>{error}</div>
      )}

      {file && (
        <div style={{ padding: '0 1.1rem' }}>
          <div className="msg-attach-preview">
            <FileText size={14} strokeWidth={2} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <button className="modal-close" style={{ width: 22, height: 22 }} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className="msg-input-bar">
        <input ref={fileInput} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
        <button className="btn-ghost btn-sm" style={{ padding: '0.5rem' }} onClick={() => fileInput.current?.click()} aria-label={t.attachFile} title={t.attachFile}>
          <Paperclip size={17} strokeWidth={1.8} />
        </button>
        <textarea
          className="form-control"
          rows={1}
          placeholder={t.typeMessage}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || (!text.trim() && !file)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <Send size={14} strokeWidth={2} />{t.send}
        </button>
      </div>
    </div>
  );
}

export default function Messages() {
  const { t }    = useLang();
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [directory, setDirectory]          = useState([]);
  const [activeId, setActiveId]            = useState(null);
  const [showDirectory, setShowDirectory]  = useState(false);
  const [search, setSearch]                = useState('');
  const [loading, setLoading]              = useState(true);
  const [liveMessage, setLiveMessage]      = useState(null);
  const [showHidden, setShowHidden]        = useState(false);
  const activeIdRef = useRef(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations || []);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  const loadDirectory = useCallback(async () => {
    try {
      const data = await getDirectory();
      setDirectory(data.users || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadConversations();
    loadDirectory();
    const id = setInterval(loadConversations, LIST_POLL_MS);
    return () => clearInterval(id);
  }, [loadConversations, loadDirectory]);

  useEffect(() => {
    window.addEventListener('focus', loadConversations);
    return () => window.removeEventListener('focus', loadConversations);
  }, [loadConversations]);

  // Live updates over SSE — new messages appear instantly without polling
  useEffect(() => {
    const es = new EventSource(streamUrl());
    es.addEventListener('message', e => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      const { conversation_id, message } = data;

      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversation_id);
        if (idx === -1) {
          loadConversations();
          return prev;
        }
        const next = [...prev];
        const conv = { ...next[idx], last_message: message };
        if (conversation_id !== activeIdRef.current && message.sender_id !== user.id) {
          conv.unread = (conv.unread || 0) + 1;
        }
        next[idx] = conv;
        next.sort((a, b) => {
          const at = a.last_message?.created_at || '';
          const bt = b.last_message?.created_at || '';
          return bt.localeCompare(at);
        });
        return next;
      });

      setLiveMessage({ conversation_id, message });
    });
    return () => es.close();
  }, [loadConversations, user.id]);

  async function handlePickUser(otherUser) {
    try {
      const { conversation } = await openDM(otherUser.id);
      setConversations(prev => {
        if (prev.some(c => c.id === conversation.id)) return prev;
        return [conversation, ...prev];
      });
      setActiveId(conversation.id);
    } catch (_) {}
    setShowDirectory(false);
    setSearch('');
  }

  async function handleStartGroup(memberIds) {
    const { conversation } = await startGroupChat(memberIds);
    setConversations(prev => {
      if (prev.some(c => c.id === conversation.id)) return prev;
      return [conversation, ...prev];
    });
    setActiveId(conversation.id);
  }

  async function handleToggleHide(conv) {
    try {
      if (conv.hidden) await unhideConversation(conv.id);
      else await hideConversation(conv.id);
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, hidden: !conv.hidden } : c));
    } catch (_) {}
  }

  function handleSelect(convId) {
    setActiveId(convId);
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread: 0 } : c));
  }

  const active = conversations.find(c => c.id === activeId);

  const query = search.trim().toLowerCase();
  const filteredConversations = !query ? conversations : conversations.filter(conv => {
    const name = conv.type === 'department' ? deptDisplayName(conv, t) : (conv.name || '');
    return name.toLowerCase().includes(query);
  });

  const dmUserIds = new Set(
    conversations.filter(c => c.type === 'dm' && c.other_user).map(c => c.other_user.id)
  );
  const filteredPeople = !query ? [] : directory.filter(u =>
    !dmUserIds.has(u.id) && u.full_name.toLowerCase().includes(query)
  );

  const visibleConversations = filteredConversations.filter(c => !c.hidden);
  const hiddenConversations  = filteredConversations.filter(c => c.hidden);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className={`msg-layout${active ? ' has-active' : ''}`}>
        <div className="msg-sidebar">
          <div className="msg-sidebar-header">
            <span className="card-title">{t.messages}</span>
            <button className="btn-header" onClick={() => setShowDirectory(true)} aria-label={t.newChat} title={t.newChat}>
              <Plus size={16} strokeWidth={2} />
            </button>
          </div>
          <div className="msg-search">
            <div style={{ position: 'relative' }}>
              <Search size={14} strokeWidth={2} style={{ position: 'absolute', top: '50%', insetInlineStart: '0.6rem', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
              <input
                className="form-control"
                style={{ padding: '0.45rem 0.7rem', paddingInlineStart: '2rem', fontSize: '0.85rem' }}
                placeholder={t.searchChats}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="msg-list">
            {loading ? (
              <div className="page-loading" style={{ height: 160 }}>
                <span className="spinner" /><span>{t.loading}</span>
              </div>
            ) : !filteredConversations.length && !filteredPeople.length ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-icon"><MessageCircle size={28} strokeWidth={1.4} /></div>
                <div className="empty-sub">{query ? t.noResults : t.noConversations}</div>
              </div>
            ) : (
              <>
                {visibleConversations.map(conv => (
                  <ConversationItem key={conv.id} conv={conv} active={conv.id === activeId} onClick={() => handleSelect(conv.id)} onToggleHide={handleToggleHide} t={t} />
                ))}
                {filteredPeople.length > 0 && (
                  <>
                    <div className="msg-list-section-label">{t.people}</div>
                    {filteredPeople.map(person => (
                      <PersonItem key={person.id} person={person} onClick={() => handlePickUser(person)} t={t} />
                    ))}
                  </>
                )}
                {hiddenConversations.length > 0 && (
                  <div className="msg-hidden-section">
                    <button className="msg-hidden-toggle" onClick={() => setShowHidden(s => !s)}>
                      {showHidden ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                      <span>{t.hiddenChats} ({hiddenConversations.length})</span>
                    </button>
                    {showHidden && hiddenConversations.map(conv => (
                      <ConversationItem key={conv.id} conv={conv} active={conv.id === activeId} onClick={() => handleSelect(conv.id)} onToggleHide={handleToggleHide} t={t} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {active ? (
          <ChatThread key={active.id} conv={active} user={user} t={t} onBack={() => setActiveId(null)} liveMessage={liveMessage} onOpenDM={handlePickUser} onStartGroup={handleStartGroup} />
        ) : (
          <div className="msg-thread" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty-state">
              <div className="empty-icon"><MessageCircle size={32} strokeWidth={1.4} /></div>
              <div className="empty-sub">{t.selectConversation}</div>
            </div>
          </div>
        )}
      </div>

      {showDirectory && (
        <DirectoryPanel onPick={handlePickUser} onClose={() => setShowDirectory(false)} t={t} />
      )}
    </div>
  );
}
