// Runs the daily payment-reminder job as if today were the given date.
//
// The job (remindPayments in server_jobs.mjs) fires from cron at 14:00 UTC, which a test
// can neither wait for nor invoke, and which email a trip gets depends on how many days
// have passed since it ran. Rather than expose a test-only route, tests shell out to this
// with a date and read the result from sent_mail.jsonl (MAIL_TRANSPORT unset = capture).
//
// Usage:  node test-helpers/remind-payments.mjs <YYYY-MM-DD>

import { remindPayments } from "../server_jobs.mjs";

const today = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) {
  console.error("Usage: node test-helpers/remind-payments.mjs <YYYY-MM-DD>");
  process.exit(1);
}

let exitCode = 0;
try {
  await remindPayments(new Date(`${today}T12:00:00Z`)); //Midday, so no timezone can shift the date
  console.log(`Payment reminders run as of ${today}`);
} catch (err) {
  console.error(err.message);
  exitCode = 1;
}

// Exit rather than sequelize.close() - see run-trip.mjs for why
process.exit(exitCode);
