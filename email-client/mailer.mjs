import nodemailer from "nodemailer";
import { promises as fs } from "fs";
import logger from "../logger.mjs";
import { renderBody } from "./render.mjs";
import "dotenv/config";

//Transport is either "capture" (append to CAPTURE_FILE, send nothing) or "smtp" (real
//delivery through the service Gmail account).
//
//It defaults to capture EVERYWHERE, and sending requires MAIL_TRANSPORT=smtp explicitly.
//The two failure modes are not equal: production not sending is recoverable and is made
//loud by a startup warning in server.mjs, while a misconfigured development box sending
//real mail to a few hundred real students is not recoverable at all. So the default is
//the one that cannot cause harm.
export const MODE = process.env.MAIL_TRANSPORT || "capture";
const CAPTURE_FILE = "./sent_mail.jsonl";
//The club's service account. Every message is from it, and addressed to it, since the
//real recipients are all BCC'd. SMTP_USER overrides it wherever mail is actually sent.
const SERVICE_ADDRESS = process.env.SMTP_USER || "brownouting.service@gmail.com";

let transporter = null;
function smtpTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false, //Port 587 starts plaintext and upgrades via STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      //A trip transition sends several messages at once; pooling reuses one
      //connection for them instead of handshaking with Gmail per message
      pool: true,
      maxConnections: 3,
      //Bounded so a hung Gmail connection can't hang a leader's request
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

//One JSON object per line, appended. Tests read this to assert what would have been
//sent. Deliberately not a JSON array: a trip transition sends several messages at once,
//and read-modify-write on a shared file loses all but the last of them.
async function capture(msg) {
  await fs.appendFile(CAPTURE_FILE, `${JSON.stringify(msg)}\n`);
}

//Gmail caps a message at 100 recipients (To + Cc + Bcc together) over SMTP. It refuses
//every RCPT past the cap with a 4xx, and nodemailer still resolves as long as one
//recipient was accepted - so an oversized BCC list silently loses its tail. That is what
//dropped 48 waitlisters on 2026-09-17. Kept well under the cap for headroom.
export const MAX_RECIPIENTS = 90;

//Gmail also caps a consumer account at about 500 recipients per rolling 24 hours, and
//past it simply refuses to send for a day. The guard below keeps a ledger of what this
//process has sent - in memory only, so a restart forgets it; that is accepted - and drops
//any BCC'd message that would cross the line, whole rather than in part, since half a
//lottery hearing is worse than none. Messages with no BCC (a note to the leaders, the
//quota notice itself) bypass it: they are a few recipients, and the 25 of headroom is
//there so they always get through.
export const DAILY_RECIPIENT_LIMIT = 475;
const DAY_MS = 24 * 60 * 60_000;
export const ledger = []; //{ sentAt, recipients } - exported so a check can prime it
function sentInLastDay() {
  const cutoff = Date.now() - DAY_MS;
  while (ledger.length && ledger[0].sentAt < cutoff) ledger.shift();
  return ledger.reduce((n, entry) => n + entry.recipients, 0);
}

//Sends one message, in as many batches as its BCC list needs. NEVER throws: every
//caller has already committed an irreversible trip transition, so a mail failure must
//be logged and swallowed rather than turned into a 500 that invites the leader to
//retry an operation they cannot repeat. Resolves false only when the daily quota guard
//dropped the message, so a route can tell the leaders.
export async function sendMail(msg) {
  //Templates supply one markup source as `text`; both bodies are derived from it so the
  //HTML and plain-text versions can never say different things.
  const body = msg.text ? renderBody(msg.text) : {};
  const message = { from: SERVICE_ADDRESS, to: SERVICE_ADDRESS, ...msg, ...body };
  const bcc = message.bcc ?? [];
  const cc = message.cc ?? [];
  //One To plus the CC'd leaders ride on every batch
  const perBatch = Math.max(1, MAX_RECIPIENTS - 1 - cc.length);
  const batches = bcc.length === 0 ? [[]] : []; //No BCC (smtp-check) is still one message
  for (let i = 0; i < bcc.length; i += perBatch) batches.push(bcc.slice(i, i + perBatch));
  if (bcc.length > 0) {
    const recipients = batches.length * (1 + cc.length) + bcc.length;
    const sent = sentInLastDay();
    if (sent + recipients > DAILY_RECIPIENT_LIMIT) {
      logger.log(`[MAIL] QUOTA "${message.subject}" -> ${bcc.length} recipient(s) NOT SENT (${sent} sent in the last 24h, limit ${DAILY_RECIPIENT_LIMIT})`);
      return false;
    }
    ledger.push({ sentAt: Date.now(), recipients });
  }
  //Sequential, so a Gmail hiccup on one batch can't interleave with the next
  for (const [i, batch] of batches.entries()) {
    const part = batches.length > 1 ? ` [${i + 1}/${batches.length}]` : "";
    await deliver({ ...message, bcc: batch }, part);
  }
  return true;
}

async function deliver(message, part) {
  const tag = `"${message.subject}"${part}`;
  try {
    let rejected = [];
    let diagnostic = "";
    if (MODE === "capture") await capture(message);
    else {
      const info = await smtpTransport().sendMail(message);
      rejected = info.rejected ?? [];
      diagnostic = info.rejectedErrors?.[0]?.response ?? "";
    }
    //Counts what the transport accepted, not what was asked for; one fixed tag on every
    //line so grepping the log for [MAIL] finds every message
    const accepted = message.bcc.filter((r) => !rejected.includes(r)).length;
    logger.log(`[MAIL] ${MODE} ${tag} -> ${accepted} recipient(s)`);
    if (rejected.length > 0) logger.log(`[MAIL] REJECTED ${tag}: ${rejected.join(", ")} - ${diagnostic}`);
  } catch (err) {
    logger.log(`[MAIL] FAILED ${tag}: ${err.message}`);
  }
}
