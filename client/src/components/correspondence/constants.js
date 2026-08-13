// Single source of truth for correspondence status/priority presentation.
// Deliberately NOT copy-pasted into each screen — the existing task components
// duplicate their STATUS_COLORS map across two files, which is how the two
// drifted apart.
import React from 'react';
import { CheckCircle2, PlusCircle, Send, XCircle, Check } from 'lucide-react';

export const STATUSES   = ['pending', 'approved', 'done', 'returned'];
export const PRIORITIES = ['high', 'med', 'low'];

export const STATUS_COLORS = {
  pending:  { bg: '#FFFBEA', color: '#B7791F', border: '#F0DCA8' },
  approved: { bg: '#EAF4EA', color: '#2D6E2D', border: '#B9DCB9' },
  done:     { bg: '#F0FFF4', color: '#276749', border: '#9AE6B4' },
  returned: { bg: '#FFF5F5', color: '#9A1818', border: '#F5AAAA' },
};

export const PRIORITY_COLORS = {
  high: { bg: '#FFF0F0', color: '#C41E1E' },
  med:  { bg: '#FFFAF0', color: '#B7791F' },
  low:  { bg: '#F2F5F2', color: '#5A6B5A' },
};

export const EVENT_ICONS = {
  created:     PlusCircle,
  approved:    Check,
  rejected:    XCircle,
  resubmitted: Send,
  completed:   CheckCircle2,
};

export const EVENT_COLORS = {
  created:     'var(--accent)',
  approved:    '#15803d',
  rejected:    '#b45309',
  resubmitted: '#0e7490',
  completed:   'var(--success)',
};

export function StatusBadge({ status, t }) {
  const c = STATUS_COLORS[status] || { bg: '#F0F0F0', color: '#666' };
  return (
    <span className="badge" style={{ background: c.bg, color: c.color, padding: '0.2rem 0.6rem' }}>
      {t?.corr?.statuses?.[status] || status}
    </span>
  );
}

export function PriorityBadge({ priority, t }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;
  return (
    <span className="badge" style={{ background: c.bg, color: c.color, padding: '0.2rem 0.6rem' }}>
      {t?.corr?.priorities?.[priority] || priority}
    </span>
  );
}

export const fmtDate = v => (v ? String(v).slice(0, 10) : '');
export const fmtDateTime = v => (v ? String(v).slice(0, 16).replace('T', ' ') : '');

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
