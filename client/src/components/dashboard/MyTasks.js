import React, { useState, useEffect, useCallback } from 'react';
import { useLang } from '../../context/LangContext';
import {
  getPersonalTasks, createPersonalTask, updatePersonalTask, deletePersonalTask,
} from '../../services/personalTaskService';
import { ListTodo, Circle, CheckCircle2, Trash2, Plus, Calendar } from 'lucide-react';
import { useConfirm } from '../common/ConfirmDialog';

function isRowOverdue(task) {
  if (task.done || !task.due_at) return false;
  return new Date(task.due_at) < new Date();
}

function MyTaskRow({ task, busy, onToggle, onDelete }) {
  const overdue = isRowOverdue(task);
  return (
    <div className={`my-task-row${task.done ? ' done' : ''}`}>
      <button type="button" className="my-task-toggle" onClick={onToggle} disabled={busy} aria-label="toggle done">
        {task.done ? <CheckCircle2 size={18} strokeWidth={1.8} /> : <Circle size={18} strokeWidth={1.8} />}
      </button>
      <span className="my-task-title">{task.title}</span>
      {task.due_at && (
        <span className={`my-task-due${overdue ? ' overdue' : ''}`}>
          <Calendar size={12} strokeWidth={1.8} />
          {String(task.due_at).slice(0, 10)}
        </span>
      )}
      <button type="button" className="my-task-delete" onClick={onDelete} disabled={busy} aria-label="delete">
        <Trash2 size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export default function MyTasks() {
  const { t } = useLang();
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [title,   setTitle]   = useState('');
  const [dueAt,   setDueAt]   = useState('');
  const [adding,  setAdding]  = useState(false);
  const [busyId,  setBusyId]  = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    getPersonalTasks()
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await createPersonalTask({ title: trimmed, due_at: dueAt || undefined });
      setTitle('');
      setDueAt('');
      load(); // re-fetch so the new item lands in its correct sorted slot
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

  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);

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
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim() || adding} aria-label="add">
          <Plus size={15} strokeWidth={2} />
        </button>
      </form>

      {loading ? (
        <div style={{ padding: '1.5rem', textAlign: 'center' }}><span className="spinner" /></div>
      ) : !items.length ? (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <div className="empty-sub">{t.myTasksEmpty}</div>
        </div>
      ) : (
        <>
          <div className="my-tasks-list">
            {open.map(task => (
              <MyTaskRow key={task.id} task={task} busy={busyId === task.id} onToggle={() => toggleDone(task)} onDelete={() => remove(task)} />
            ))}
            {!open.length && <div className="empty-sub" style={{ padding: '0.75rem 1rem' }}>{t.myTasksEmpty}</div>}
          </div>

          {done.length > 0 && (
            <>
              <button type="button" className="my-tasks-toggle-done" onClick={() => setShowDone(s => !s)}>
                {showDone ? t.myTasksHideDone : (t.myTasksShowDone || '').replace('{n}', done.length)}
              </button>
              {showDone && (
                <div className="my-tasks-list">
                  {done.map(task => (
                    <MyTaskRow key={task.id} task={task} busy={busyId === task.id} onToggle={() => toggleDone(task)} onDelete={() => remove(task)} />
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
