import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

// A searchable, grouped department picker. Replaces the plain 22-entry <select>
// that appears in the user-assignment modals and the correspondence composer.
//
// Grouping is derived from the id rather than a hand-kept list, so a department
// added later through the Super Admin panel lands in the right group with no
// code change: anything ending in `_office` is an office, `other_dept` sorts
// last, everything else is a department, sorted by Arabic collation.
function group(depts, t) {
  const offices = [], normal = [], tail = [];
  for (const d of depts) {
    const id = d.id || d.key;
    if (id === 'other_dept') tail.push(d);
    else if (/_office$/.test(id)) offices.push(d);
    else normal.push(d);
  }
  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), 'ar');
  normal.sort(byLabel);
  return [
    { title: t?.deptGroupOffices || 'المكاتب', items: offices },
    { title: t?.deptGroupDepts   || 'الأقسام', items: normal },
    { title: '', items: tail },
  ].filter(g => g.items.length);
}

export default function DepartmentSelect({
  departments = [], value, onChange, t,
  placeholder, emptyLabel, disabled = false, required = false, id,
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(0);
  const boxRef   = useRef(null);
  const inputRef = useRef(null);

  const norm = list => list.map(d => ({
    id:    d.id ?? d.key,
    label: d.label ?? d.name ?? d.id ?? d.key,
  }));
  const all = useMemo(() => norm(departments), [departments]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return all;
    return all.filter(d => d.label.includes(q) || d.id.toLowerCase().includes(q.toLowerCase()));
  }, [all, query]);

  const groups  = useMemo(() => group(filtered, t), [filtered, t]);
  const flat    = groups.flatMap(g => g.items);
  const current = all.find(d => d.id === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  function pick(deptId) {
    onChange?.(deptId);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape')      { setOpen(false); return; }
    if (e.key === 'ArrowDown')   { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')  { e.preventDefault(); if (flat[active]) pick(flat[active].id); }
  }

  let runningIndex = -1;

  return (
    <div className="dept-select" ref={boxRef}>
      <button
        type="button"
        id={id}
        className="form-control dept-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(o => !o)}>
        <span className={current ? '' : 'dept-select-placeholder'}>
          {current ? current.label : (placeholder || emptyLabel || '—')}
        </span>
        <ChevronDown size={15} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {open && (
        <div className="dept-select-menu" role="listbox">
          <div className="dept-select-search">
            <Search size={14} strokeWidth={2} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={t?.deptSearchPlaceholder || 'ابحث عن قسم…'} />
            {query && (
              <button type="button" className="dept-select-clear" onClick={() => setQuery('')} aria-label="clear">
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="dept-select-list">
            {!required && (
              <button
                type="button"
                className={`dept-select-option${!value ? ' selected' : ''}`}
                onClick={() => pick('')}>
                {emptyLabel || '—'}
              </button>
            )}

            {!flat.length && (
              <div className="dept-select-empty">{t?.noResults || 'لا توجد نتائج'}</div>
            )}

            {groups.map((g, gi) => (
              <div key={gi}>
                {g.title && <div className="dept-select-group">{g.title}</div>}
                {g.items.map(d => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={d.id === value}
                      className={`dept-select-option${d.id === value ? ' selected' : ''}${idx === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(d.id)}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
