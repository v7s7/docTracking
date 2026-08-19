import React from 'react';
import { useLang } from '../../context/LangContext';
import { fmtDate } from './constants';

// Hidden container. @media print in index.css hides the whole app and reveals
// only this, so window.print() produces the formal letter and nothing else.
//
// The date system is a single constant: the build brief specifies ar-SA, which
// renders Hijri. Switch DATE_LOCALE to 'ar-BH' for Gregorian, or set DUAL_DATE
// to show both — nothing else in the file needs to change.
const DATE_LOCALE = 'ar-SA';
const DUAL_DATE   = false;

function officialDate(d = new Date()) {
  const hijri = d.toLocaleDateString(DATE_LOCALE);
  if (!DUAL_DATE) return hijri;
  return `${hijri} الموافق ${d.toLocaleDateString('ar-BH')}`;
}

export default function PrintLetter({ item }) {
  const { t } = useLang();
  const c = t.corr;
  if (!item) return null;

  const p = c.print;
  const senderTitle = item.from_dept_label || item.from_dept_id;

  return (
    <div className="print-letter" id="corr-print" aria-hidden="true">
      <div className="pl-accent" />

      <div className="pl-head">
        <div className="pl-logo">
          <img src="/logo.png" alt="" />
        </div>
        <div className="pl-org">
          <div className="pl-kingdom">{p.kingdom}</div>
          <div className="pl-admin">{t.orgName}</div>
          <div className="pl-system">{p.systemName}</div>
        </div>
        <div className="pl-ref">
          <div className="pl-ref-label">{p.refNo}</div>
          <div className="pl-ref-no">{item.serial}</div>
          <div className="pl-ref-date">{fmtDate(item.created_at)}</div>
        </div>
      </div>

      <div className="pl-bismillah">{p.bismillah}</div>
      <div className="pl-pill">{p.officialMemo}</div>

      <table className="pl-meta">
        <tbody>
          <tr>
            <th>{c.subject}</th>
            <td colSpan={3}>{item.subject}</td>
          </tr>
          <tr>
            <th>{c.sender}</th>
            <td>{item.from_user_name}</td>
            <th>{c.fromDept}</th>
            <td>{item.from_dept_label}</td>
          </tr>
          <tr>
            <th>{c.toDept}</th>
            <td>{item.to_dept_label}</td>
            <th>{c.priority}</th>
            <td><span className={`pl-pill-sm pl-prio-${item.priority}`}>{c.priorities[item.priority]}</span></td>
          </tr>
          <tr>
            <th>{c.status}</th>
            <td colSpan={3}>
              <span className={`pl-pill-sm pl-status-${item.status}`}>{c.statuses[item.status]}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="pl-salutation">
        <div>{p.messrs} / {item.to_dept_label}   {p.mayGodProtect}</div>
        <div>{p.greeting}</div>
      </div>

      <div className="pl-body-label">{c.body}</div>
      <div className="pl-body">{item.body}</div>

      {item.rejection_reason && (
        <div className="pl-reject">
          <strong>{c.rejectReason}:</strong> {item.rejection_reason}
        </div>
      )}

      {!!item.attachments?.length && (
        <div className="pl-attach">
          <div className="pl-attach-title">{c.attachments}</div>
          <ol>
            {item.attachments.map((a, i) => (
              <li key={a.id || i}>{a.file_name}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="pl-closing">{p.closing}</div>

      <div className="pl-sign">
        <div className="pl-sign-label">{c.sender}</div>
        <div className="pl-sign-space" />
        <div className="pl-sign-name">{item.from_user_name}</div>
        <div className="pl-sign-title">{senderTitle}</div>
        {item.from_user_ext && (
          <div className="pl-sign-title" dir="ltr">{t.directory.ext}: {item.from_user_ext}</div>
        )}
      </div>

      {!!item.events?.length && (
        <div className="pl-timeline">
          {item.events.map((e, i) => (
            <div className="pl-tl-row" key={e.id || i}>
              <span className={`pl-tl-dot pl-ev-${e.type}`} />
              <span className="pl-tl-text">
                {c.events[e.type] || e.type} — {e.actor_name}
              </span>
              <span className="pl-tl-date">{String(e.created_at || '').slice(0, 16)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pl-foot">
        <div>{t.orgName}</div>
        <div>{p.printedOn} {officialDate()}</div>
        <div>{item.serial}</div>
      </div>
    </div>
  );
}
