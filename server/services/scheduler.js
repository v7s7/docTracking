// server/services/scheduler.js
// Daily cron + a startup catch-up run for the overdue/due-soon reminder
// check. Both are safe to run any number of times — runReminderCheck
// dedupes per task per calendar day via tasks.last_reminder_at.
const cron = require('node-cron');
const { runReminderCheck } = require('./reminderService');

function start() {
  // 07:00 every day, server local time.
  cron.schedule('0 7 * * *', () => {
    runReminderCheck()
      .then(r => console.log('[Reminders] Daily run:', r))
      .catch(err => console.error('[Reminders] Daily run failed:', err.message));
  });

  // Catch-up shortly after boot, in case the server was down at 07:00.
  // Deduped by last_reminder_at, so this won't double-send if the 07:00
  // run already fired today.
  setTimeout(() => {
    runReminderCheck()
      .then(r => console.log('[Reminders] Startup run:', r))
      .catch(err => console.error('[Reminders] Startup run failed:', err.message));
  }, 15_000);

  console.log('[Reminders] Scheduler started — daily run at 07:00, plus startup catch-up.');
}

module.exports = { start };
