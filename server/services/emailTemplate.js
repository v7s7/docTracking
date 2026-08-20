// server/services/emailTemplate.js
//
// One layout for every message the system sends. Four services were each
// hand-rolling their own HTML, so the notifications looked like four different
// products — and every one of them led with English in an Arabic-first system.
//
// Email HTML is not web HTML. Outlook renders through Word: no flexbox, no
// grid, no <style> blocks worth trusting, no shorthand background. Tables and
// inline styles only, and every colour spelled out because CSS variables do not
// exist here.
const BRAND = {
  green:  '#1C7C1C',   // --primary, the logo palm-tree green
  ink:    '#1A1A1A',
  muted:  '#6B6B6B',   // --text-3
  border: '#E8E8E8',
  wash:   '#F5F5F5',   // --bg
};

const ORG = 'الإدارة العامة للأوقاف السنية';
const APP = 'نظام تتبع الوثائق';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Arabic counts a noun four different ways. "1 محادثة" and "2 محادثة" are both
 * wrong, and "1 conversation(s)" is the kind of thing that makes software feel
 * unfinished.
 *
 *   1      محادثة واحدة
 *   2      محادثتان
 *   3-10   ٣ محادثات
 *   11+    ١٥ محادثة
 */
function arabicPlural(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

const CONVERSATIONS = ['محادثة واحدة', 'محادثتان', 'محادثات', 'محادثة'];

/**
 * Wrap content in the branded shell.
 *
 * @param title    the Arabic headline, shown in the green bar
 * @param lead     one Arabic sentence under it
 * @param bodyHtml already-escaped markup for the middle
 * @param ctaUrl   where the button goes; omitted entirely when falsy, because a
 *                 button linking to "localhost" is worse than no button
 * @param ctaLabel Arabic button text
 * @param footer   optional English one-liner, small and grey at the bottom
 */
function layout({ title, lead, bodyHtml = '', ctaUrl = '', ctaLabel = 'فتح النظام', footer = '' }) {
  const button = ctaUrl ? `
    <tr><td align="center" style="padding:26px 24px 6px;">
      <a href="${esc(ctaUrl)}"
         style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;
                font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;
                padding:12px 34px;border-radius:6px;">${esc(ctaLabel)}</a>
    </td></tr>` : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.wash};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${BRAND.wash};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND.border};
                    border-radius:10px;overflow:hidden;">

        <tr><td style="background:${BRAND.green};padding:18px 24px;" dir="rtl">
          <div style="font-family:Tahoma,Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;">${esc(ORG)}</div>
          <div style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:#D8EED8;padding-top:3px;">${esc(APP)}</div>
        </td></tr>

        <tr><td style="padding:26px 24px 0;" dir="rtl">
          <div style="font-family:Tahoma,Arial,sans-serif;font-size:19px;font-weight:bold;color:${BRAND.ink};">${esc(title)}</div>
          ${lead ? `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:${BRAND.muted};padding-top:8px;line-height:1.7;">${esc(lead)}</div>` : ''}
        </td></tr>

        ${bodyHtml ? `<tr><td style="padding:18px 24px 0;" dir="rtl">${bodyHtml}</td></tr>` : ''}
        ${button}

        <tr><td style="padding:24px;">
          <div style="border-top:1px solid ${BRAND.border};padding-top:14px;
                      font-family:Tahoma,Arial,sans-serif;font-size:11px;color:${BRAND.muted};
                      text-align:center;line-height:1.6;" dir="rtl">
            رسالة آلية من ${esc(APP)} — لا حاجة للرد عليها.
            ${footer ? `<br><span dir="ltr">${esc(footer)}</span>` : ''}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** A simple two-column table — label on the right, a number on the left. */
function rowsTable(rows, [headA, headB]) {
  const body = rows.map(r => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid ${BRAND.border};
                 font-family:Tahoma,Arial,sans-serif;font-size:14px;color:${BRAND.ink};">${esc(r.label)}</td>
      <td align="center" style="padding:9px 12px;border-bottom:1px solid ${BRAND.border};
                 font-family:Tahoma,Arial,sans-serif;font-size:14px;font-weight:bold;color:${BRAND.green};
                 width:70px;">${esc(r.value)}</td>
    </tr>`).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
    <tr style="background:${BRAND.wash};">
      <th align="right" style="padding:9px 12px;font-family:Tahoma,Arial,sans-serif;
                 font-size:12px;color:${BRAND.muted};font-weight:normal;">${esc(headA)}</th>
      <th align="center" style="padding:9px 12px;font-family:Tahoma,Arial,sans-serif;
                 font-size:12px;color:${BRAND.muted};font-weight:normal;width:70px;">${esc(headB)}</th>
    </tr>
    ${body}
  </table>`;
}

/** A block of body text, e.g. the text of a تعميم. */
function paragraph(text) {
  return `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:${BRAND.ink};
                      line-height:1.9;white-space:pre-wrap;">${esc(text)}</div>`;
}

/**
 * Isolate a value that may be Latin inside an Arabic line.
 *
 * Without this, «من: Abdulaziz Taha Alkubaesy — قسم تقنية المعلومات» renders as
 * "Abdulaziz Taha Alkubaesyقسم تقنية المعلومات" — the bidi algorithm moves the
 * separator to the far side of the Latin run and the two collide. <bdi> is the
 * element for this but email clients do not support it reliably, so an explicit
 * dir + unicode-bidi:isolate on a span is used instead.
 */
function ltr(v) {
  return `<span dir="ltr" style="unicode-bidi:isolate;display:inline-block;">${esc(v)}</span>`;
}

/**
 * Label/value table. Each field gets its OWN row — mixing a Latin name and an
 * Arabic department on one line is what broke the correspondence email, and the
 * fix is to stop putting them on the same line at all.
 *
 * Pass { label, value, latin } — latin:true isolates the value.
 */
function kvTable(fields) {
  const rows = fields.filter(f => f && f.value).map(f => `
    <tr>
      <td style="padding:7px 0 7px 14px;font-family:Tahoma,Arial,sans-serif;font-size:12px;
                 color:${BRAND.muted};white-space:nowrap;vertical-align:top;">${esc(f.label)}</td>
      <td style="padding:7px 0;font-family:Tahoma,Arial,sans-serif;font-size:14px;
                 color:${BRAND.ink};font-weight:bold;">${f.latin ? ltr(f.value) : esc(f.value)}</td>
    </tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="rtl"
                 style="width:100%;">${rows}</table>`;
}

/** Small grey key/value line — «رقم التعميم: DC-2026-0001». */
function meta(pairs) {
  return pairs.filter(p => p && p[1]).map(([k, v]) =>
    `<div style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:${BRAND.muted};padding-top:4px;">
       ${esc(k)}: <span style="color:${BRAND.ink};">${esc(v)}</span></div>`).join('');
}

module.exports = { layout, rowsTable, kvTable, paragraph, meta, ltr, arabicPlural, CONVERSATIONS, esc, BRAND };
