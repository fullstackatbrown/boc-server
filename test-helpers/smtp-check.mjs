// Real-send check for the BOC email notifications. Run from boc-server:
//   MAIL_TRANSPORT=smtp node <path-to-this-file>
//
// Everything is addressed to the service account itself. It never touches the
// seeded database's real Brown addresses.
import "dotenv/config";
import nodemailer from "nodemailer";

const SERVICE = process.env.SMTP_USER;

if (!SERVICE || !process.env.SMTP_PASS) {
  console.error("FAIL: SMTP_USER / SMTP_PASS are not set in boc-server/.env");
  console.error("      (uncomment both lines and replace the placeholder password)");
  process.exit(1);
}
if (process.env.SMTP_PASS.includes("<")) {
  console.error("FAIL: SMTP_PASS is still the placeholder, not a real App Password");
  process.exit(1);
}

// STAGE 1 - do the credentials authenticate at all?
const transport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: SERVICE, pass: process.env.SMTP_PASS },
});
await transport.verify();
console.log("STAGE 1 ok - SMTP authentication succeeded");

// STAGE 2 - drive the real notification path end to end. The stub trip supplies
// getUsers because that is all queries.getLeaderEmails calls; leaders and
// recipients are both the service account, so nothing reaches a student.
const { notifyLottery, notifyAttendance } = await import("../email-client/notifications.mjs");

const stubTrip = {
  id: 6,
  tripName: "SMTP Check (ignore)",
  plannedDate: "2026-09-15",
  getUsers: async () => [{ email: SERVICE }],
};

await notifyLottery(stubTrip, {
  accepted: [SERVICE],
  waitlisted: [SERVICE],
  notAccepted: [SERVICE], // normally empty; exercised here since no test covers it
});
await notifyAttendance(stubTrip, { attended: [SERVICE], noShow: [SERVICE] });

console.log("STAGE 2 ok - five messages sent through notifications.mjs");
console.log("Check the service account inbox; each should render with Cc and Reply-To set.");
process.exit(0);
