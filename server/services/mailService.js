// server/services/mailService.js
// Thin nodemailer wrapper for reminder emails. Sending is best-effort: if
// SMTP isn't configured or the relay is unreachable, callers should keep
// working (in-app notifications still fire) instead of crashing.
const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;

  if (!process.env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 25,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    // Internal relay's cert is issued for a hostname, not the IP in SMTP_HOST —
    // skip hostname verification but keep the connection encrypted.
    tls: { rejectUnauthorized: false },
  });
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const list = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (!list.length) return false;

  // THE master switch, checked here so nothing can route around it — every
  // email in the system goes through this function. Off means nothing leaves
  // the building, while in-app notifications, badges and read receipts carry on
  // exactly as normal.
  //
  // Required lazily: mailService is loaded by services that db/index.js pulls in,
  // so a top-level require here would be circular.
  const { isEmailEnabled } = require('./settingsService');
  if (!isEmailEnabled()) {
    // Loud and specific. Silence here would look identical to a broken relay,
    // and someone would spend an afternoon debugging SMTP.
    console.log(`[Mail] SUPPRESSED (email switch is OFF) — would have sent "${subject}" to ${list.length} recipient(s)`);
    return false;
  }

  // Many recipients go in bcc: a تعميم reaches the whole organisation, and
  // putting 118 colleagues in a visible To: header discloses everyone's address
  // to everyone and invites reply-all.
  const many = list.length > 1;
  const recipients = many ? undefined : list[0];
  const bcc = many ? list.join(',') : undefined;

  const t = getTransporter();
  if (!t) {
    console.warn('[Mail] SMTP_HOST not set — skipping email:', subject);
    return false;
  }

  try {
    const from = process.env.SMTP_FROM_DEFAULT || 'Doc Tracking <noreply@doctracking.local>';
    await t.sendMail({
      from,
      // With a bcc list the envelope still needs a To:, and the sender address
      // is the conventional choice — it keeps the message from looking like it
      // was addressed to nobody, without naming any recipient.
      to: recipients || from,
      bcc,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error('[Mail] Failed to send:', err.message);
    return false;
  }
}

module.exports = { sendMail };
