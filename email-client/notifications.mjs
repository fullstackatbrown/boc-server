import moment from "moment";
import { sendMail } from "./mailer.mjs";
import queries from "../queries.mjs";
const { getLeaderEmails, tripPrice } = queries;
import "dotenv/config";

//Every link points back into the site; the trip page is a query param, not a path.
//Keep this in sync with project-boc's routing - a rename there sends students dead links.
const SITE = process.env.FRONTEND_URL || "http://localhost:3000";
const tripUrl = (trip) => `${SITE}/trips/view?id=${trip.id}`;
//Trips recur seasonally, so the year matters
const when = (trip) => moment(trip.plannedDate).format("dddd, MMMM D, YYYY");
const SIGNOFF = "See you outside,\nThe Brown Outing Club";
//Where participants pay. Also hardcoded in project-boc's SignupButton.tsx.
const STORE_URL = "https://payment.brown.edu/C20460_ustores/web/store_cat.jsp?STOREID=2&CATID=396";

//What to buy on the Marketplace, worded exactly as the site's Pay popup words it
//(project-boc SignupButton.tsx) so a reminder never contradicts the page. Class items
//are priced $5 x letter (A=$5 ... J=$50), so an over-priced trip is bought as J plus one
//more; payments/receipt.mjs adds up such a cart. Needs trip.TripClass included.
const classPrice = (letter) => 5 * (letter.charCodeAt(0) - 64);
const dollars = (n) => `$${n}`;
function purchase(trip) {
  const cost = tripPrice(trip);
  if (trip.class) return `the *Outing Club-Class ${trip.class} Trip* item (${dollars(cost)})`;
  if (cost % 5 !== 0) return `the special Marketplace item priced *${dollars(cost)}* for this trip`;
  const remainder = cost % 50;
  const classes = [...(remainder ? [String.fromCharCode(64 + remainder / 5)] : []), ...Array(Math.floor(cost / 50)).fill("J")];
  const combo = classes.map((c) => `Class ${c} (${dollars(classPrice(c))})`).join(" + ");
  return `a special Marketplace item priced exactly *${dollars(cost)}* for this trip if there is one, ` +
    `and otherwise the Class items that add up to it - *${combo}* - *in the same cart, in one checkout* ` +
    `(bought separately they won't be recorded)`;
}
const howToPay = (trip) =>
  `You can pay on [Brown Marketplace](${STORE_URL}). Check out with your *Brown or RISD email address* - that is how the payment gets matched to you - and buy ${purchase(trip)}. Financial aid promo codes are applied at checkout; if cost is a concern, check out our [financial aid policy](${SITE}/about/financial-aid).`;

//Each template returns { subject, text }. Copy lives here and nowhere else - editing
//the wording of an email should never mean touching sending logic.

//Written to read like a note from a person, not a notice. The previous wording -
//"[ACTION REQUIRED]", "Congratulations, you were selected", "click Confirm", "you might
//lose it" - was bounced by Gmail's outbound spam filter for every recipient of the
//2026-09-17 Apple Picking lottery. No shouting, no urgency, one plain link.
const selected = (trip) => ({
  subject: `SELECTED - ${trip.tripName}`,
  text: `The lottery for ${trip.tripName} (${when(trip)}) has run, and you have a spot on the trip!

To keep it, please confirm on the [trip page](${tripUrl(trip)}). You'll need to be signed in to the site with your Brown account to see the Confirm button. Spots that are still unconfirmed a couple days or so before the trip may be offered to those on the waitlist.

If you can no longer make it, please cancel on that same page so your spot can go to someone else.

The leaders will send trip details (meeting time, what to bring) before the day. Any questions, just reply to this email - it goes straight to them.

${SIGNOFF}`,
});

const waitlisted = (trip) => ({
  subject: `WAITLISTED - ${trip.tripName}`,
  text: `You are currently on the waitlist for ${trip.tripName} on ${when(trip)}. While you weren't directly selected, spots open up pretty regularly and your odds of getting on the trip if you're still interested are probably better than you think. 

If you're still interested, please *confirm your interest* via the [trip page](${tripUrl(trip)}) - you'll need to be signed in to the site with your Brown account to see the Confirm button. Confirming your interest now will give you priority over all other waitlisted participants who have not done so. 

If you do not end up with a spot on the trip, we're sorry we weren't able to bring you with us! To compensate, your odds of getting on the next trip you sign up for will be increased.

${SIGNOFF}`,
});

const notSelected = (trip) => ({
  subject: `Status Update: ${trip.tripName}`,
  text: `Unfortunately you were not selected for ${trip.tripName} on ${when(trip)}, and you didn't make the waitlist either. Sorry about that.

We're sorry we weren't able to bring you with us; to compensate, your odds of getting on the next trip you sign up for are increased. Feel free to take a look at what we have coming up on our [trips page](${SITE}/trips). 

${SIGNOFF}`,
});

//Same register as `selected`, for the same reason
const promoted = (trip) => ({
  subject: `You have a spot on ${trip.tripName}!`,
  text: `A spot opened up on ${trip.tripName} (${when(trip)}), and it's yours - you've been moved off the waitlist.

If you haven't already, please confirm on the [trip page](${tripUrl(trip)}) so the leaders know you're coming. You'll need to be signed in to the site with your Brown account to see the Confirm button. If some time passes without a confirmation, the spot may be passed along to the next person on the waitlist; if you're no longer interested, please cancel on the same page instead.

The leaders will send trip details (meeting time, what to bring) before the day. Any questions, just reply to this email - it goes straight to them.

${SIGNOFF}`,
});

const thanks = (trip) => ({
  subject: `Thanks for coming on ${trip.tripName}`,
  text: `Thanks for coming out on ${trip.tripName} - we hope you enjoyed it as much as we did!

Everything else we have coming up is [here](${SITE}/trips) and we look forward to seeing you on another trip soon!

${SIGNOFF}`,
});

const noShow = (trip) => ({
  subject: `We missed you on ${trip.tripName}`,
  text: `Our records show you were signed up for ${trip.tripName} on ${when(trip)} but didn't make it, and we didn't hear from you beforehand.

Things come up, and we understand that. But a spot nobody claims is a spot another student could have had, so missing a trip without notice does *lower your odds in future trip lotteries*.

If you know ahead of time that you can't make a trip, cancel on the [trip page](${tripUrl(trip)}) or let the leaders know. That costs you nothing and frees the spot for someone on the waitlist.

If you think this is a mistake, just reply to this email - the trip's leaders will see it.

${SIGNOFF}`,
});

//Sent daily for a week after a trip to attendees who haven't paid (see remindPayments in
//server_jobs.mjs). Passive on purpose: most people just haven't got round to it.
const paymentDue = (trip) => ({
  subject: `Payment reminder - ${trip.tripName}`,
  text: `Thanks again for coming out on ${trip.tripName} on ${when(trip)}! Our records show the ${dollars(tripPrice(trip))} trip fee hasn't come through yet.

${howToPay(trip)}

The [trip page](${tripUrl(trip)}) will show you as paid within a few minutes of checkout. Until then, you'll get one of these a day, so no need to reply - unless you've already paid, in which case reply with your Marketplace order number and the trip's leaders will sort it out.

${SIGNOFF}`,
});

//The last automated reminder, on day seven; the leaders get the list the same day.
const paymentOverdue = (trip) => ({
  subject: `[ACTION REQUIRED] Payment overdue - ${trip.tripName}`,
  text: `It has been a week since ${trip.tripName} on ${when(trip)}, and our records still show the ${dollars(tripPrice(trip))} trip fee unpaid. This is the last automated reminder you'll get: your name has been passed to the trip's leaders, who will follow up with you directly.

${howToPay(trip)}

If you've already paid, or if cost is the issue, just reply to this email---it goes to the trip's leaders---and they'll work it out with you.

${SIGNOFF}`,
});

const unpaidHandoff = (trip, participants) => ({
  subject: `Unpaid participants - ${trip.tripName}`,
  text: `A week has passed since ${trip.tripName} on ${when(trip)}, and these participants are still recorded as unpaid (${dollars(tripPrice(trip))} each). They have had a reminder every day and were told today that you would be following up, so it's over to you:

${participants.map((p) => `${p.firstName} ${p.lastName} - ${p.email}`).join("\n")}

The [trip page](${tripUrl(trip)}) shows who has paid, and updates within minutes of a Marketplace checkout. If someone shows you a receipt the site never matched, an admin can mark them paid by hand.

The Brown Outing Club website`,
});

//Deliberately links to the trips page, not the trip page: by the time this sends, the
//trip has been deleted and its page would 404.
const cancelled = (trip) => ({
  subject: `CANCELLED - ${trip.tripName}`,
  text: `We're sorry to say that ${trip.tripName} on ${when(trip)} has been *cancelled* and will not be running.

You don't need to do anything - your spot has been released. If you already paid for this trip, just reply to this email and the trip's leaders will sort out a refund with you.

We're sorry to miss out on this one with you. Everything else we have coming up is on our [trips page](${SITE}/trips), and we hope to see you on one of those soon.

${SIGNOFF}`,
});

//One message per recipient group. Participants are BCC'd so they never see each
//other's addresses - which also keeps a no-show from seeing who else no-showed.
//Leaders are CC'd so they see exactly what their participants got, and are Reply-To
//so a reply reaches a person rather than the unattended service account.
async function send(leaders, recipients, { subject, text }) {
  if (recipients.length === 0) return; //Nothing to tell anyone
  return sendMail({
    cc: leaders,
    replyTo: leaders.join(", "),
    bcc: recipients,
    subject,
    text,
  });
}

export async function notifyLottery(trip, { accepted, waitlisted: waited, notAccepted }) {
  const leaders = await getLeaderEmails(trip);
  await Promise.all([
    send(leaders, accepted, selected(trip)),
    send(leaders, waited, waitlisted(trip)),
    send(leaders, notAccepted, notSelected(trip)),
  ]);
}

//Takes a list of emails, not one address, so a batch waitlist add sends one message
export async function notifyWaitlistPromotion(trip, emails) {
  if (emails.length === 0) return; //Nothing promoted, so no leader lookup needed
  await send(await getLeaderEmails(trip), emails, promoted(trip));
}

//Takes the leader list rather than looking it up: the trip and its signups are already
//gone by the time this runs, so getLeaderEmails would come back empty.
export async function notifyTripCancellation(trip, { leaders, recipients }) {
  await send(leaders, recipients, cancelled(trip));
}

//Excused absences appear in neither list: they cancelled ahead of time and are
//deliberately mailed nothing.
export async function notifyAttendance(trip, { attended, noShow: noShows }) {
  const leaders = await getLeaderEmails(trip);
  await Promise.all([
    send(leaders, attended, thanks(trip)),
    send(leaders, noShows, noShow(trip)),
  ]);
}

export async function notifyPaymentReminder(trip, emails, { final }) {
  const leaders = await getLeaderEmails(trip);
  await send(leaders, emails, final ? paymentOverdue(trip) : paymentDue(trip));
}

//To the leaders themselves, so no BCC and no CC
export async function notifyUnpaidHandoff(trip, participants) {
  const leaders = await getLeaderEmails(trip);
  await sendMail({ to: leaders, ...unpaidHandoff(trip, participants) });
}
