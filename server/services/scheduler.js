// server/services/scheduler.js
// Daily cron + a startup catch-up run for the overdue/due-soon task
// reminder check, plus a more frequent check for chat messages sitting
// unread too long. Both are safe to run any number of times —
// runReminderCheck dedupes per task per calendar day via
// tasks.last_reminder_at, and runChatReminderCheck dedupes per user per
// calendar day via users.last_chat_reminder_at.
const cron = require('node-cron');
const { runReminderCheck } = require('./reminderService');
const { runChatReminderCheck } = require('./chatReminderService');

function start() {
  // 07:00 every day, server local time.
  cron.schedule('0 7 * * *', () => {
    runReminderCheck()
      .then(r => console.log('[Reminders] Daily run:', r))
      .catch(err => console.error('[Reminders] Daily run failed:', err.message));
  });

  // Every minute. The chat check is now a 5-minute quiet window rather than a
  // 1-hour staleness timer, so it has to run far more often than the daily
  // digests. It is cheap when idle: one query per person who actually has
  // something unread, and nothing at all otherwise.
  cron.schedule('* * * * *', () => {
    runChatReminderCheck()
      .then(r => console.log('[Chat reminders] Run:', r))
      .catch(err => console.error('[Chat reminders] Run failed:', err.message));
  });

  // Catch-up shortly after boot, in case the server was down at 07:00.
  // Deduped by last_reminder_at / last_chat_reminder_at, so this won't
  // double-send if a scheduled run already fired today.
  setTimeout(() => {
    runReminderCheck()
      .then(r => console.log('[Reminders] Startup run:', r))
      .catch(err => console.error('[Reminders] Startup run failed:', err.message));
    runChatReminderCheck()
      .then(r => console.log('[Chat reminders] Startup run:', r))
      .catch(err => console.error('[Chat reminders] Startup run failed:', err.message));
  }, 15_000);

  console.log('[Reminders] Scheduler started — task digest daily at 07:00, chat check every 30 min, plus startup catch-up.');
}

module.exports = { start };
