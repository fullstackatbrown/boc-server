// Checks the daily recipient guard in email-client/mailer.mjs without sending anything.
// Run from boc-server with MAIL_TRANSPORT unset (capture) against the seeded database:
//   node test-helpers/mail-quota-check.mjs
//
// Primes the in-memory ledger to just under the limit, then drives the real lottery
// notification for seed trip 8 (leader: William) and asserts that the participants'
// message was dropped, the leaders were told, and a small message still goes through.
import "dotenv/config";
import assert from "assert/strict";
import { promises as fs } from "fs";

assert.equal(process.env.MAIL_TRANSPORT ?? "capture", "capture", "must run in capture mode");
const CAPTURE_FILE = "./sent_mail.jsonl";
const captured = async () => (await fs.readFile(CAPTURE_FILE, "utf8").catch(() => "")).split("\n").filter(Boolean).map(JSON.parse);
const before = (await captured()).length;
const fresh = async () => (await captured()).slice(before);

const { sendMail, ledger, DAILY_RECIPIENT_LIMIT } = await import("../email-client/mailer.mjs");
const { notifyLottery } = await import("../email-client/notifications.mjs");
const { default: models } = await import("../models.mjs");

ledger.push({ sentAt: Date.now(), recipients: DAILY_RECIPIENT_LIMIT - 10 });
const trip = await models.Trip.findByPk(8);
const fakes = Array.from({ length: 12 }, (_, i) => `quota${i}@brown.edu`);

// A 12-person SELECTED message won't fit; the leaders must hear instead
await notifyLottery(trip, { accepted: fakes, waitlisted: [], notAccepted: [] });
let mail = await fresh();
assert.equal(mail.length, 1, "exactly one message: the notice, not the lottery mail");
assert.equal(mail[0].to[0], "william_l_stone@brown.edu");
assert.match(mail[0].subject, /^NOT SENT: SELECTED - /);
assert.match(mail[0].text, /12 participant\(s\)/);
assert.doesNotMatch(mail[0].html, /\*|\]\(/, "markup left unconverted");

// A 3-person message still fits under the limit (1 To + 1 CC + 3 BCC = 5 <= 10 left)
assert.equal(await sendMail({ cc: ["leader@brown.edu"], bcc: fakes.slice(0, 3), subject: "fits", text: "x" }), true);
// ...and now 5 are left, so 4 BCC + To + CC = 6 does not
assert.equal(await sendMail({ cc: ["leader@brown.edu"], bcc: fakes.slice(0, 4), subject: "does not fit", text: "x" }), false);
// A leaders-only message bypasses the guard entirely
assert.equal(await sendMail({ to: ["leader@brown.edu"], subject: "bypass", text: "x" }), true);
mail = await fresh();
assert.deepEqual(mail.map((m) => m.subject), ["NOT SENT: SELECTED - Pre-Trip Test Trip", "fits", "bypass"]);

// Entries older than a day fall out of the window
ledger.length = 0;
ledger.push({ sentAt: Date.now() - 25 * 60 * 60_000, recipients: DAILY_RECIPIENT_LIMIT });
assert.equal(await sendMail({ bcc: fakes, subject: "yesterday is forgotten", text: "x" }), true);

console.log("ok - quota guard drops whole messages at the limit, tells the leaders, and lets small mail through");
process.exit(0); //queries.mjs's background sync holds the pool open - see run-trip.mjs
