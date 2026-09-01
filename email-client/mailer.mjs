import nodemailer from "nodemailer";
import { promises as fs } from "fs";
import logger from "../logger.mjs";
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

//Sends one message. NEVER throws: every caller has already committed an irreversible
//trip transition, so a mail failure must be logged and swallowed rather than turned
//into a 500 that invites the leader to retry an operation they cannot repeat.
export async function sendMail(msg) {
  const message = { from: SERVICE_ADDRESS, to: SERVICE_ADDRESS, ...msg };
  try {
    if (MODE === "capture") await capture(message);
    else await smtpTransport().sendMail(message);
    //One fixed tag on both lines so grepping the log for [MAIL] finds every message
    logger.log(`[MAIL] ${MODE} "${message.subject}" -> ${message.bcc?.length ?? 0} recipient(s)`);
  } catch (err) {
    logger.log(`[MAIL] FAILED "${message.subject}": ${err.message}`);
  }
}
