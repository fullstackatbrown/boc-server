// Checks the bounce watch. Run from boc-server:
//   node test-helpers/bounces-check.mjs          parse the fixture, touch nothing
//   LIVE=1 node test-helpers/bounces-check.mjs   also round-trip it through Gmail
//
// Stage 1 parses test-helpers/bounces/dsn-failure.eml - the real bounce Gmail sent for
// the 2026-09-17 SELECTED email, with the students replaced by seeded test users - and
// asserts the facts the log line is built from.
//
// Stage 2 (LIVE=1, needs SMTP_USER / SMTP_PASS) appends the fixture to the service
// account's inbox, starts the watcher exactly as server.mjs does, and waits for the
// `[MAIL] BOUNCED` line to reach log.txt. The fixture is given a fresh Message-ID for
// each run - Gmail de-duplicates appends by Message-ID and would otherwise hand back the
// previous run's copy, labels and all - and it is deleted afterwards. Nothing is sent to
// anyone.
import "dotenv/config";
import assert from "assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

//The watcher is gated on MAIL_TRANSPORT=smtp, read when the module loads - so set it
//before importing, and only for the live stage
const LIVE = process.env.LIVE === "1";
if (LIVE) process.env.MAIL_TRANSPORT = "smtp";
const { parseBounce, tickBounceWatcher, DISABLED } = await import("../email-client/bounces.mjs");

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "bounces", "dsn-failure.eml");
const source = await fs.readFile(FIXTURE);

// STAGE 1 - parsing
assert.deepEqual(parseBounce(source), {
  recipient: "test@du.de",
  action: "failed",
  status: "5.7.1",
  diagnostic: "Message rejected. For more information, go to https://support.google.com/mail/answer/69585",
  subject: "[ACTION REQUIRED] SELECTED - Apple Picking",
});
//A DSN with no delivery-status part still names its recipient in Gmail's summary header
const headerOnly = source.toString().replace(/^Final-Recipient:.*\r?\n/m, "");
assert.equal(parseBounce(headerOnly).recipient, "test@du.de");
assert.throws(() => parseBounce("Subject: nothing useful\r\n\r\nbody"), /recipient/);
console.log("STAGE 1 ok - the fixture parses to the expected facts");

if (!LIVE) {
  console.log("(set LIVE=1 to round-trip the fixture through Gmail)");
  process.exit(0);
}

// STAGE 2 - the live path. The log the watcher writes is ./log.txt, the same file
// server.mjs uses.
const { ImapFlow } = await import("imapflow");
const { default: logger } = await import("../logger.mjs");
assert.equal(DISABLED, null, "watcher would not start: " + DISABLED);

const imap = () => new ImapFlow({
  host: "imap.gmail.com", port: 993, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, logger: false,
});
//Start the watcher first and let its sweep finish, so the fixture arrives on the IDLE
//push path - the one a real bounce takes - rather than being found by the sweep
await logger.start();
await tickBounceWatcher();
const plant = imap();
await plant.connect();
const messageId = `<dsn-fixture-${Date.now()}@boc.test>`;
const { uid } = await plant.append("INBOX", Buffer.from(source.toString("latin1").replace("<dsn-fixture-failure@boc.test>", messageId), "latin1"));
console.log(`planted fixture as INBOX uid ${uid}`);
const deadline = Date.now() + 30_000;
let logged = "";
while (Date.now() < deadline) {
  const log = await fs.readFile("./log.txt", "utf8");
  logged = log.split("\n").find((l) => l.includes("[MAIL] BOUNCED test@du.de")) ?? "";
  if (logged) break;
  await new Promise((r) => setTimeout(r, 1000));
}
//Clean up whether or not it worked. Gmail's only reliable delete over IMAP is a move to
//Trash (which strips every label) followed by a delete from Trash; deleting from All Mail
//or the inbox just re-files the message. Matched by fetching envelopes, since a header
//search is answered from an index that lags.
const fixtureUids = async () => {
  const uids = [];
  for await (const m of plant.fetch({ since: new Date(Date.now() - 3600_000), from: "mailer-daemon" }, { envelope: true, uid: true }))
    if (m.envelope.messageId === messageId) uids.push(m.uid);
  return uids;
};
for (const [box, act] of [["[Gmail]/All Mail", (u) => plant.messageMove(u, "[Gmail]/Trash", { uid: true })], ["[Gmail]/Trash", (u) => plant.messageDelete(u, { uid: true })]]) {
  const lock = await plant.getMailboxLock(box);
  try {
    const uids = await fixtureUids();
    if (uids.length) await act(uids);
    console.log(`${box}: cleared ${uids.length} copy(ies) of the fixture`);
  } finally { lock.release(); }
}
await plant.logout();

assert.ok(logged, "no [MAIL] BOUNCED line reached log.txt within 30s");
//The label applied after logging is what keeps a re-sweep from logging it again
await tickBounceWatcher();
const lines = (await fs.readFile("./log.txt", "utf8")).split("\n").filter((l) => l.includes("[MAIL] BOUNCED"));
assert.equal(lines.filter((l) => l.includes("test@du.de")).length, 1, "bounce logged more than once");
console.log("STAGE 2 ok - " + logged.trim());
process.exit(0);
