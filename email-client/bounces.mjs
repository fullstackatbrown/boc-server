//Watches the club Gmail account for the Delivery Status Notifications Gmail sends when it
//refuses a message AFTER accepting it at SMTP. That is how the 2026-09-17 SELECTED email
//reached nobody while mailer.mjs logged success: Gmail's outbound spam filter bounced it
//to all 16 recipients two seconds later, and the bounces sat unread in the service inbox.
//This turns each one into a `[MAIL] BOUNCED` log line within seconds of it arriving.
//
//Runs inside the Express process like the mail client, on the same App Password (SMTP_USER
/// SMTP_PASS grant IMAP access too). One connection stays open in IMAP IDLE on the inbox;
//Gmail signals ("exists") whenever mail lands, and the search below picks out anything
//from mailer-daemon that hasn't been labelled BOC/Bounces yet. The label is applied after
//logging, so restarts and reconnects never log a bounce twice, and a human reading the
//inbox cannot hide one. It also runs once at startup and daily (server_jobs.mjs) as a
//safety net, since Gmail drops long-lived connections and imapflow does not reconnect.
//
//Only Google's own DSNs (mailer-daemon@googlemail.com) are watched. That is every bounce
//there is today: Gmail sends one for anything it refuses outbound, and Brown and RISD
//both run on Google Workspace, so a rejection on their side comes from the same daemon.
//
//Gated on MAIL_TRANSPORT=smtp rather than a flag of its own: a box that sends no mail has
//no bounces to watch, and a box that does send is the one that must see them.
import "dotenv/config";
import logger from "../logger.mjs";
import { MODE } from "./mailer.mjs";

//Why the watcher is off, or null when it is on. server.mjs already warns when the transport
//is not smtp, which covers this; it is exported so bounces-check.mjs can assert it is on.
export const DISABLED =
  MODE !== "smtp" ? "MAIL_TRANSPORT is not smtp"
  : !process.env.SMTP_USER || !process.env.SMTP_PASS ? "SMTP_USER / SMTP_PASS are not set"
  : null;
const INBOX = "INBOX";
const SEEN = "BOC/Bounces";
const DAEMON = "mailer-daemon";
//Bounces older than this at startup are history, not news
const LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 10 * 60_000;

let client = null;
let connecting = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let running = false;
let rerun = false;

//Reads the facts out of a DSN (RFC 3464): who was refused, what Gmail said, and which
//message it was about. Pure, so it can be tested against a fixture without Gmail.
//The original message's headers ride along in a text/rfc822-headers part; its Subject is
//what a leader needs to see, since every trip email is one subject per recipient group.
export function parseBounce(source) {
  const text = source.toString();
  const header = (name, from = 0) => {
    const m = text.slice(from).match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"));
    return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : null;
  };
  const recipient = header("Final-Recipient")?.replace(/^rfc822;\s*/i, "") ?? header("X-Failed-Recipients");
  if (!recipient) throw new Error("no recipient in delivery status");
  const originalAt = text.search(/^Content-Type:\s*(text\/rfc822-headers|message\/rfc822)/im);
  return {
    recipient,
    action: header("Action") ?? "failed",
    status: header("Status") ?? "",
    diagnostic: header("Diagnostic-Code")?.replace(/^smtp;\s*/i, "") ?? "",
    subject: originalAt >= 0 ? header("Subject", originalAt) : null,
  };
}

function log(msg) { return logger.log(`[MAIL] ${msg}`); }

//Logs, then labels, each bounce not yet seen. Never throws.
async function processBounces() {
  if (running) { rerun = true; return; } //A push arrived mid-run; go again after
  running = true;
  try {
    const query = { from: DAEMON, since: new Date(Date.now() - LOOKBACK_MS), labels: { not: [SEEN] } };
    const uids = await client.search(query, { uid: true });
    for (const uid of uids || []) {
      const range = String(uid);
      const msg = await client.fetchOne(range, { source: true }, { uid: true });
      if (!msg) continue;
      try {
        const b = parseBounce(msg.source);
        const verdict = b.action.toLowerCase() === "failed" ? "BOUNCED" : b.action.toUpperCase();
        await log(`${verdict} ${b.recipient} re: "${b.subject ?? "?"}" - ${b.status} ${b.diagnostic}`.trim());
      } catch (err) {
        await log(`BOUNCE uid ${uid} could not be read: ${err.message}`);
      }
      await client.messageCopy(range, SEEN, { uid: true });
    }
  } catch (err) {
    await log(`bounce watch run failed: ${err.message}`);
  } finally {
    running = false;
    if (rerun) { rerun = false; processBounces(); }
  }
}

async function connect() {
  //Loaded here, not at module top: imapflow costs ~28MB of RSS, which every box that
  //leaves the watcher off (the default) should not pay
  const { ImapFlow } = await import("imapflow");
  const conn = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
  });
  conn.on("error", (err) => log(`bounce watch connection error: ${err.message}`));
  conn.on("close", () => {
    if (client === conn) { client = null; scheduleReconnect(); }
  });
  await conn.connect();
  try {
    const boxes = await conn.list();
    if (!boxes.some((box) => box.path === SEEN)) await conn.mailboxCreate(SEEN);
    await conn.mailboxOpen(INBOX);
  } catch (err) {
    conn.close(); //Gmail allows 15 connections per account; a retry loop must not leak them
    throw err;
  }
  conn.on("exists", () => processBounces()); //Gmail's push: something just landed in the inbox
  client = conn;
  reconnectDelay = RECONNECT_MIN_MS;
  await log("bounce watch connected");
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await ensureConnected();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

//Connects if not connected. Never throws: failures are logged and retried with backoff.
//The daily tick and the reconnect timer can overlap, so one attempt is shared.
async function ensureConnected() {
  if (client?.usable) return true;
  connecting ??= connect().finally(() => { connecting = null; });
  try {
    await connecting;
    return true;
  } catch (err) {
    await log(`bounce watch connect failed (retrying in ${reconnectDelay / 1000}s): ${err.message}`);
    scheduleReconnect();
    return false;
  }
}

//Called once from server.mjs at startup, and daily from server_jobs.mjs as a safety net.
export async function tickBounceWatcher() {
  if (DISABLED) return;
  if (await ensureConnected()) await processBounces();
}
