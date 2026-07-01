import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import {
  getPersonalTasks, createPersonalTask, updatePersonalTask, deletePersonalTask,
} from '../../services/personalTaskService';
import { ListTodo, Circle, CheckCircle2, Trash2, Plus, Calendar, BellOff } from 'lucide-react';
import { useConfirm } from '../common/ConfirmDialog';

const CATEGORIES = ['catWork', 'catPersonal', 'catFollowUp'];

const CAT_COLORS = {
  catWork:      { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  catPersonal:  { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
  catFollowUp:  { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
};

function getSnoozed() {
  try { return JSON.parse(localStorage.getItem('myTasksSnoozed') || '{}'); } catch (_) { return {}; }
}
function setSnoozedStore(map) {
  try { localStorage.setItem('myTasksSnoozed', JSON.stringify(map)); } catch (_) {}
}

function isRowOverdue(task) {
  if (task.done || !task.due_at) return false;
  return new Date(task.due_at) < new Date();
}

function MyTaskRow({ task, busy, onToggle, onDelete, onSnooze, catLabel }) {
  const overdue = isRowOverdue(task);
  const snoozed = getSnoozed();
  const isSnoozed = snoozed[task.id] && Date.now() < snoozed[task.id];
  const catKey = Object.keys(CAT_COLORS).find(k => catLabel === k);
  const catStyle = catKey ? CAT_COLORS[catKey] : null;

  return (
    <div className={`my-task-row${task.done ? ' done' : ''}`}>
      <button type="button" className="my-task-toggle" onClick={onToggle} disabled={busy} aria-label="toggle done">
        {task.done ? <CheckCircle2 size={18} strokeWidth={1.8} /> : <Circle size={18} strokeWidth={1.8} />}
      </button>
      <span className="my-task-title">{task.title}</span>
      {task.category && catStyle && (
        <span style={{
          fontSize: '0.67rem', fontWeight: 700, borderRadius: 99,
          padding: '1px 7px', whiteSpace: 'nowrap',
          background: catStyle.bg, color: catStyle.color, border: `1px solid ${catStyle.border}`,
        }}>
          {catLabel}
        </span>
      )}
      {task.due_at && (
        <span className={`my-task-due${overdue ? ' overdue' : ''}`}>
          <Calendar size={12} strokeWidth={1.8} />
          {String(task.due_at).slice(0, 10)}
        </span>
      )}
      {overdue && !task.done && !isSnoozed && (
        <button type="button" className="my-task-delete" onClick={onSnooze} disabled={busy}
          title="Snooze 2h" aria-label="snooze reminder 2 hours"
          style={{ color: 'var(--text-3)' }}>
          <BellOff size={13} strokeWidth={1.8} />
        </button>
      )}
      <button type="button" className="my-task-delete" onClick={onDelete} disabled={busy} aria-label="delete">
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export default function MyTasks() {
  const { t } = useLang();
  const [items,          setItems]         = useState([]);
  const [loading,        setLoading]       = useState(true);
  const [title,          setTitle]         = useState('');
  const [dueAt,          setDueAt]         = useState('');
  const [category,       setCategory]      = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [adding,         setAdding]        = useState(false);
  const [busyId,         setBusyId]        = useState(null);
  const [showDone,       setShowDone]      = useState(false);
  const [, forceUpdate]  = useState(0);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    getPersonalTasks()
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function checkReminders() {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      let notified = [];
      try { notified = JSON.parse(localStorage.getItem('myTasksNotified') || '[]'); } catch (_) {}
      const snoozed = getSnoozed();
      const now = Date.now();
      const overdue = items.filter(task =>
        isRowOverdue(task) &&
        !notified.includes(task.id) &&
        (!snoozed[task.id] || now > snoozed[task.id])
      );
      if (!overdue.length) return;
      overdue.forEach(task => {
        const n = new Notification(t.myTasksReminderTitle, {
          body: t.myTasksReminderBody.replace('{title}', task.title),
          tag: `my-task-${task.id}`,
        });
        n.onclick = () => window.focus();
      });
      const updated = [...notified, ...overdue.map(task => task.id)];
      try { localStorage.setItem('myTasksNotified', JSON.stringify(updated)); } catch (_) {}
    }
    checkReminders();
    const id = setInterval(checkReminders, 60000);
    return () => clearInterval(id);
  }, [items, t]);

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await createPersonalTask({ title: trimmed, due_at: dueAt || undefined, category: category || undefined });
      setTitle('');
      setDueAt('');
      setCategory('');
      load();
    } catch (_) {
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(task) {
    setBusyId(task.id);
    try {
      const { item } = await updatePersonalTask(task.id, { done: !task.done });
      setItems(prev => prev.map(i => (i.id === item.id ? item : i)));
    } catch (_) {
    } finally {
      setBusyId(null);
    }
  }

  async function remove(task) {
    if (!await confirm(t.confirmDel)) return;
    setBusyId(task.id);
    try {
      await deletePersonalTask(task.id);
      setItems(prev => prev.filter(i => i.id !== task.id));
    } catch (_) {
      setBusyId(null);
    }
  }

  function snoozeTask(task) {
    const snoozed = getSnoozed();
    snoozed[task.id] = Date.now() + 2 * 60 * 60 * 1000;
    setSnoozedStore(snoozed);
    forceUpdate(n => n + 1); // re-render to hide the snooze button
  }

  const usedCategories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const filterItems = (arr) => categoryFilter
    ? arr.filter(i => i.category === categoryFilter)
    : arr;

  const open = filterItems(items.filter(i => !i.done));
  const done = filterItems(items.filter(i => i.done));

  return (
    <div className="card my-tasks-card">
      {confirmDialog}
      <div className="card-header">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ListTodo size={17} strokeWidth={1.8} />
          {t.myTasks}
        </div>
      </div>

      <form className="my-tasks-add-row" onSubmit={handleAdd}>
        <input
          type="text"
          className="form-control"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t.myTasksAddPH}
          maxLength={300}
        />
        <input
          type="date"
          className="form-control my-tasks-due-input"
          value={dueAt}
          onChange={e => setDueAt(e.target.value)}
          title={t.myTasksDueOptional}
        />
        <select
          className="form-control my-tasks-due-input"
          value={category}
          onChange={e => setCategory(e.target.value)}
          title={t.taskCategory}
          style={{ width: 'auto', fontSize: '0.82rem' }}
        >
          <option value="">{t.taskCategory}</option>
          {CATEGORIES.map(k => <option key={k} value={k}>{t[k]}</option>)}
        </select>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || adding} aria-label="add">
          <Plus size={15} strokeWidth={2} />
        </button>
      </form>

      {/* Category filter tabs */}
      {usedCategories.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', padding: '0 1rem 0.75rem', flexWrap: 'wrap' }}>
          <button type="button"
            onClick={() => setCategoryFilter('')}
            style={{
              padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600,
              background: !categoryFilter ? 'var(--accent)' : 'var(--surface-2)',
              color: !categoryFilter ? '#fff' : 'var(--text-2)',
              border: `1px solid ${!categoryFilter ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer',
            }}>
            {t.allCategories}
          </button>
          {usedCategories.map(k => {
            const s = CAT_COLORS[k] || {};
            const active = categoryFilter === k;
            return (
              <button key={k} type="button"
                onClick={() => setCategoryFilter(active ? '' : k)}
                style={{
                  padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600,
                  background: active ? s.color : s.bg,
                  color: active ? '#fff' : s.color,
                  border: `1px solid ${s.border || 'var(--border)'}`,
                  cursor: 'pointer',
                }}>
                {t[k]}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '1.5rem', textAlign: 'center' }}><span className="spinner" /></div>
      ) : !items.length ? (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <div className="empty-sub">{t.myTasksEmpty}</div>
        </div>
      ) : (
        <>
          <div className="my-tasks-section-label">
            {(t.myTasksToDo || 'To do').replace('{n}', open.length)}
          </div>
          <div className="my-tasks-list">
            {open.map(task => (
              <MyTaskRow
                key={task.id} task={task}
                busy={busyId === task.id}
                catLabel={task.category}
                onToggle={() => toggleDone(task)}
                onDelete={() => remove(task)}
                onSnooze={() => snoozeTask(task)}
              />
            ))}
            {!open.length && <div className="empty-sub" style={{ padding: '0.75rem 1rem' }}>{t.myTasksAllDone || t.myTasksEmpty}</div>}
          </div>

          {done.length > 0 && (
            <>
              <button type="button" className="my-tasks-toggle-done" onClick={() => setShowDone(s => !s)}>
                {showDone ? t.myTasksHideDone : (t.myTasksShowDone || '').replace('{n}', done.length)}
              </button>
              {showDone && (
                <div className="my-tasks-list">
                  {done.map(task => (
                    <MyTaskRow
                      key={task.id} task={task}
                      busy={busyId === task.id}
                      catLabel={task.category}
                      onToggle={() => toggleDone(task)}
                      onDelete={() => remove(task)}
                      onSnooze={() => snoozeTask(task)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
