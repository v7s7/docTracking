// server/services/settingsService.js
//
// Switches an administrator can flip at runtime, stored in the database rather
// than in .env. The difference matters: .env needs a file edit on the server and
// a restart, which is not something you can do while people are watching.
//
// Read on every use, never cached. These are flipped rarely and read rarely, and
// a cached "email is on" that is actually off would be worse than the lookup.
const { db } = require('../db');

const DEFAULTS = {
  // Master switch for ALL outgoing email — correspondence notifications,
  // التعاميم, and the chat digest alike. Off means nothing is sent; everything
  // else (in-app notifications, badges, read receipts) carries on untouched, so
  // the system can be demonstrated end to end without mailing 118 people.
  email_enabled: 'true',
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULTS[key] ?? null);
}

function setSetting(key, value, byUsername) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, datetime('now','localtime'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(key, String(value), byUsername || null);
  return getSetting(key);
}

/** Anything other than the literal 'false' counts as on, so a bad value fails safe. */
const isEmailEnabled = () => getSetting('email_enabled') !== 'false';

function emailStatus() {
  const row = db.prepare("SELECT value, updated_at, updated_by FROM app_settings WHERE key='email_enabled'").get();
  return {
    enabled: isEmailEnabled(),
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
    // Whether a relay is even configured. The switch being on does not mean
    // mail can actually leave the building.
    smtpConfigured: !!process.env.SMTP_HOST,
  };
}

module.exports = { getSetting, setSetting, isEmailEnabled, emailStatus, DEFAULTS };
