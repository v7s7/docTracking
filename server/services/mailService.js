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
  const recipients = Array.isArray(to) ? to.filter(Boolean).join(',') : to;
  if (!recipients) return false;

  const t = getTransporter();
  if (!t) {
    console.warn('[Mail] SMTP_HOST not set — skipping email:', subject);
    return false;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM_DEFAULT || 'Doc Tracking <noreply@doctracking.local>',
      to: recipients,
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
