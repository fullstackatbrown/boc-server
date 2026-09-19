//Watches the club Gmail account for Brown Marketplace receipts and records each one as a
//payment (queries.applyPayment). Runs inside the Express process like the mail client,
//and reuses its App Password: SMTP_USER / SMTP_PASS grant IMAP access too.
//
//How receipts reach us: TouchNet mails campuspayments@touchnet.com -> outing@brown.edu ->
//(forward) -> this account, where a Gmail filter on that sender applies the label
//BOC/Receipts. That label is the mailbox watched here. A second label, BOC/Processed, is
//applied by this module to every receipt it has handled; the search below excludes them,
//so restarts and reconnects never double-count. Both labels and the filter are set up by
//hand in the Gmail UI - see prod-CLAUDE.md.
//
//Push, not polling: one connection stays open in IMAP IDLE and Gmail signals ("exists")
//the moment a receipt is labelled. The connection also runs once at startup, and a daily
//job (server_jobs.mjs) reconnects and re-runs it as a safety net, since Gmail does drop
//long-lived connections and imapflow deliberately does not reconnect on its own.
//
//Off by default everywhere. A development box that processes real receipts labels them
//and production then never sees them, so - exactly like MAIL_TRANSPORT - enabling this
//is an explicit production act. PAYMENT_WATCH_SINCE (a date) is required alongside it so
//the first run can't chew through the historical backlog against unreliable `paid` data.
import "dotenv/config";
import logger from "../logger.mjs";
import queries from "../queries.mjs";
import { parseReceipt } from "./receipt.mjs";

const SINCE = new Date(process.env.PAYMENT_WATCH_SINCE);
//Why the watcher is off, or null when it is on. server.mjs turns this into a startup warning.
export const DISABLED =
  process.env.PAYMENT_WATCH !== "1" ? "PAYMENT_WATCH is not set"
  : isNaN(SINCE) ? "PAYMENT_WATCH_SINCE is unset or not a date"
  : null;
const RECEIPTS = "BOC/Receipts";
const PROCESSED = "BOC/Processed";
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 10 * 60_000;

let client = null;
let connecting = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let running = false;
let rerun = false;

function log(msg) { return logger.log(`[PAYMENTS] ${msg}`); }

//Parses, labels, then applies each unprocessed receipt - in that order. Parsing is pure,
//so a failure there leaves the message unlabelled for a fixed parser to pick up later.
//Labelling BEFORE applying means a crash between the two loses a receipt rather than
//applying it twice on the next run: a lost receipt gets a student pestered until an
//admin fixes it, a doubled one quietly gives someone a free trip. Never throws.
async function processReceipts() {
  if (running) { rerun = true; return; } //A push arrived mid-run; go again after
  running = true;
  try {
    const uids = await client.search({ since: SINCE, labels: { not: [PROCESSED] } }, { uid: true });
    for (const uid of uids || []) {
      const range = String(uid);
      const msg = await client.fetchOne(range, { source: true }, { uid: true });
      if (!msg) continue;
      let receipt;
      try { receipt = parseReceipt(msg.source); }
      catch (err) { await log(`uid ${uid}: NOT PROCESSED, parse failed: ${err.message}`); continue; }
      await client.messageCopy(range, PROCESSED, { uid: true });
      const marked = await queries.applyPayment(receipt);
      const who = `order ${receipt.orderNumber} ${receipt.email} class ${receipt.tripClass} $${receipt.unitPrice}`;
      if (marked.length) {
        const trips = marked.map((s) => `trip ${s.tripId} "${s.Trip.tripName}"`).join(", ");
        await log(`${who} -> paid ${trips}`);
      } else {
        await log(`${who} -> no matching user/signup, disregarded`);
      }
    }
  } catch (err) {
    await log(`run failed: ${err.message}`);
  } finally {
    running = false;
    if (rerun) { rerun = false; processReceipts(); }
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
  conn.on("error", (err) => log(`connection error: ${err.message}`));
  conn.on("close", () => {
    if (client === conn) { client = null; scheduleReconnect(); }
  });
  await conn.connect();
  try {
    //The receipts label is a human-made Gmail filter target; its absence means the filter
    //is gone and no receipt will ever arrive, which must be loud rather than silent
    const boxes = await conn.list();
    if (!boxes.some((box) => box.path === RECEIPTS)) {
      throw new Error(`mailbox "${RECEIPTS}" is missing - has the Gmail filter been deleted?`);
    }
    if (!boxes.some((box) => box.path === PROCESSED)) await conn.mailboxCreate(PROCESSED);
    await conn.mailboxOpen(RECEIPTS);
  } catch (err) {
    conn.close(); //Gmail allows 15 connections per account; a retry loop must not leak them
    throw err;
  }
  conn.on("exists", () => processReceipts()); //Gmail's push: a receipt was just labelled
  client = conn;
  reconnectDelay = RECONNECT_MIN_MS;
  await log("connected, watching for receipts");
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
    await log(`connect failed (retrying in ${reconnectDelay / 1000}s): ${err.message}`);
    scheduleReconnect();
    return false;
  }
}

//Called once from server.mjs at startup, and daily from server_jobs.mjs as a safety net.
export async function tickPaymentWatcher() {
  if (DISABLED) return;
  if (await ensureConnected()) await processReceipts();
}
