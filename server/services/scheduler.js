// server/services/scheduler.js
// A recurring check for chat messages sitting unread too long. Safe to run any
// number of times — runChatReminderCheck dedupes per (person, conversation) via
// chat_email_log, and returns early when the master email switch is off.
//
// The daily 07:00 task digest that used to live here is retired with نظام
// المهام; reminderService itself is still on disk and still reachable through
// POST /admin/reminders/run, so nothing is lost if the module comes back.
const cron = require('node-cron');
const { runChatReminderCheck } = require('./chatReminderService');

function start() {
  // The 07:00 task digest is RETIRED along with نظام المهام (see index.js).
  // It emailed people about tasks in a module nothing can reach any more, which
  // is worse than sending nothing. Left commented rather than deleted so it
  // comes back with the module if that is ever reversed.
  //
  // cron.schedule('0 7 * * *', () => {
  //   runReminderCheck()
  //     .then(r => console.log('[Reminders] Daily run:', r))
  //     .catch(err => console.error('[Reminders] Daily run failed:', err.message));
  // });

  // Every minute. The chat check is now a 5-minute quiet window rather than a
  // 1-hour staleness timer, so it has to run far more often than the daily
  // digests. It is cheap when idle: one query per person who actually has
  // something unread, and nothing at all otherwise.
  cron.schedule('* * * * *', () => {
    runChatReminderCheck()
      // Logged only when it actually did something. A line a minute reporting
      // that nothing happened is 1,440 a day, and a real error scrolls out of
      // reach between them — which is how a 500 sat unnoticed in this very log.
      // The startup run below always prints, so "is it alive?" still has an answer.
      .then(r => { if (r.notified || r.emailed) console.log('[Chat reminders] Run:', r); })
      .catch(err => console.error('[Chat reminders] Run failed:', err.message));
  });

  // Catch-up shortly after boot, in case the server was down when a run was due.
  // Deduped by last_chat_reminder_at, so this won't double-send if a scheduled
  // run already fired.
  setTimeout(() => {
    runChatReminderCheck()
      .then(r => console.log('[Chat reminders] Startup run:', r))
      .catch(err => console.error('[Chat reminders] Startup run failed:', err.message));
  }, 15_000);

  console.log('[Reminders] Scheduler started — chat check every minute, plus startup catch-up. (Task digest retired with نظام المهام.)');
}

module.exports = { start };
