// server/services/correspondenceNotify.js
// Tells the right people that a memo needs them — in the notification bell and
// by email. Best-effort throughout: a dead SMTP relay must never stop a memo
// being approved, so every failure is logged and swallowed.
//
// Why a separate table: the existing `notifications` table has
// `task_id INTEGER NOT NULL` with a foreign key to `tasks`, so it physically
// cannot hold a correspondence row without rebuilding it. This one is keyed by
// user_id rather than dept_id, because for correspondence we always know
// exactly who needs to act.
const { db } = require('../db');
const { sendMail } = require('./mailService');
const { readConfig } = require('../services/configService');
const { layout, kvTable } = require('./emailTemplate');
const { approversOf, DEPT_APPROVER_ROLES } = require('../utils/approvals');
const chat = require('./chatBridge');

db.exec(`
  CREATE TABLE IF NOT EXISTS correspondence_notifications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    correspondence_id INTEGER NOT NULL,
    serial            TEXT,
    subject           TEXT,
    type              TEXT NOT NULL,
    is_read           INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(correspondence_id) REFERENCES correspondences(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_corr_notif_user ON correspondence_notifications(user_id, is_read);
`);

const APP_URL = process.env.APP_URL || '';

const COPY = {
  // type            → [ Arabic heading, what the recipient should do ]
  needs_approval: ['مراسلة بانتظار موافقتك', 'تحتاج هذه المراسلة إلى موافقتك قبل إرسالها إلى القسم المستلم.'],
  approved:       ['تمت الموافقة على مراسلتك', 'وافق رئيس القسم على مراسلتك وتم إرسالها إلى القسم المستلم.'],
  returned:       ['مراسلتك مُعادة للمراجعة', 'أُعيدت مراسلتك إليك مع بيان السبب. يمكنك تعديلها وإعادة إرسالها.'],
  incoming:       ['مراسلة واردة إلى قسمك', 'وصلت مراسلة جديدة إلى قسمك بانتظار الإنجاز.'],
  completed:      ['تم إنجاز مراسلتك', 'أنجز القسم المستلم مراسلتك.'],
};

const deptLabel = id =>
  (readConfig().departments || []).find(d => d.id === id)?.label || id || '';

// Everyone who may approve on behalf of `deptId`: whoever is named head or
// deputy in the config, plus anyone holding a department-approver role there.
function approverUsers(deptId) {
  const names = approversOf(deptId);
  const rows = [];
  if (names.length) {
    rows.push(...db.prepare(
      `SELECT * FROM users WHERE is_active = 1 AND username IN (${names.map(() => '?').join(',')})`
    ).all(...names));
  }
  rows.push(...db.prepare(
    `SELECT * FROM users WHERE is_active = 1 AND dept_id = ?
       AND role IN (${DEPT_APPROVER_ROLES.map(() => '?').join(',')})`
  ).all(deptId, ...DEPT_APPROVER_ROLES));

  return [...new Map(rows.map(u => [u.id, u])).values()];
}

const deptUsers = deptId =>
  db.prepare('SELECT * FROM users WHERE is_active = 1 AND dept_id = ?').all(deptId);

const userById = id =>
  id ? db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id) : null;

function emailBody(type, item) {
  const [title, action] = COPY[type] || ['إشعار مراسلة', ''];
  return layout({
    title,
    lead: action,
    // One field per row. The old version put «الاسم — القسم» on a single line,
    // and with a Latin name in an RTL paragraph the bidi algorithm threw the
    // separator to the far side, so the two ran together as
    // "Abdulaziz Taha Alkubaesyقسم تقنية المعلومات". Separate rows cannot collide.
    bodyHtml: kvTable([
      { label: 'رقم المراسلة', value: item.serial || '', latin: true },
      { label: 'الموضوع',      value: item.subject || '' },
      { label: 'المرسل',       value: item.from_user_name || '', latin: true },
      { label: 'القسم المرسل', value: deptLabel(item.from_dept_id) },
      { label: 'القسم المستلم', value: deptLabel(item.to_dept_id) },
    ]),
    ctaUrl: APP_URL,
    ctaLabel: 'فتح المراسلة',
  });
}

/**
 * Record an in-app notification for each recipient and email those who have an
 * address. Never throws.
 *
 * @param {string} type  one of the COPY keys
 * @param {object} item  the correspondence row
 * @param {Array}  users recipient user rows
 */
function notify(type, item, users) {
  const recipients = (users || []).filter(Boolean);
  if (!recipients.length) return;

  try {
    const insert = db.prepare(`
      INSERT INTO correspondence_notifications (user_id, correspondence_id, serial, subject, type)
      VALUES (?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const u of recipients) insert.run(u.id, item.id, item.serial, item.subject, type);
    })();
  } catch (e) {
    console.warn('[CorrNotify] could not record notification:', e.message);
  }

  const emails = recipients.map(u => u.email).filter(Boolean);
  if (!emails.length) return;
  const [title] = COPY[type] || ['إشعار مراسلة'];
  sendMail({
    to: emails,
    subject: `${title} — ${item.serial || ''}`,
    html: emailBody(type, item),
    text: `${title}\n${item.subject || ''}\n${item.serial || ''}`,
  }).catch(e => console.warn('[CorrNotify] email failed:', e.message));
}

// ── The five workflow moments ─────────────────────────────────────────────
const onSubmitted = item => notify('needs_approval', item, approverUsers(item.from_dept_id));
const onApproved  = item => {
  notify('approved', item, [userById(item.from_user_id)]);
  notify('incoming', item, deptUsers(item.to_dept_id));
  // People already keep the department channel open — announce the arrival
  // there rather than relying on them to check an inbox.
  chat.postToDepartment(item.to_dept_id,
    `📩 مراسلة واردة ${item.serial} — «${item.subject}» من ${deptLabel(item.from_dept_id)} · بانتظار الإنجاز`);
};
const onRejected  = item => notify('returned',  item, [userById(item.from_user_id)]);
const onCompleted = item => notify('completed', item, [userById(item.from_user_id)]);

module.exports = { onSubmitted, onApproved, onRejected, onCompleted, notify };
