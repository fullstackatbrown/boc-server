import moment from "moment";
import { sendMail } from "./mailer.mjs";
import queries from "../queries.mjs";
const { getLeaderEmails } = queries;
import "dotenv/config";

//Every link points back into the site; the trip page is a query param, not a path.
//Keep this in sync with project-boc's routing - a rename there sends students dead links.
const SITE = process.env.FRONTEND_URL || "http://localhost:3000";
const tripUrl = (trip) => `${SITE}/trips/view?id=${trip.id}`;
//Trips recur seasonally, so the year matters
const when = (trip) => moment(trip.plannedDate).format("dddd, MMMM D, YYYY");
const SIGNOFF = "See you outside,\nThe Brown Outing Club";

//Each template returns { subject, text }. Copy lives here and nowhere else - editing
//the wording of an email should never mean touching sending logic.

//Written to read like a note from a person, not a notice. The previous wording -
//"[ACTION REQUIRED]", "Congratulations, you were selected", "click Confirm", "you might
//lose it" - was bounced by Gmail's outbound spam filter for every recipient of the
//2026-09-17 Apple Picking lottery. No shouting, no urgency, one plain link.
const selected = (trip) => ({
  subject: `You have a spot on ${trip.tripName}`,
  text: `The lottery for ${trip.tripName} (${when(trip)}) has run, and you have a spot on the trip.

To keep it, please confirm on the [trip page](${tripUrl(trip)}). You'll need to be signed in to the site with your Brown account to see the Confirm button. Spots that are still unconfirmed shortly before the trip may be offered to the waitlist.

If you can no longer make it, please cancel on that same page so your spot can go to someone else.

The leaders will send trip details (meeting time, what to bring) before the day. Any questions, just reply to this email - it goes straight to them.

${SIGNOFF}`,
});

const waitlisted = (trip) => ({
  subject: `[ACTION REQUIRED] WAITLISTED - ${trip.tripName}`,
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

//Same subject as `selected`, and the same calm register, for the same reason
const promoted = (trip) => ({
  subject: `You have a spot on ${trip.tripName}`,
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
