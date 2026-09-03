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

const selected = (trip) => ({
  subject: `[ACTION REQUIRED] SELECTED - ${trip.tripName}`,
  text: `Congratulations, you were selected for ${trip.tripName} on ${when(trip)}!

While you currently have a spot on the trip, we still need you to *confirm your spot* for you to keep it. If you have not confirmed your spot shortly before the date of the trip, you might lose it to someone on the waitlist. To confirm your spot, visit the [trip page on the website](${tripUrl(trip)}) and click "Confirm". 

If you can no longer make it, please visit that same page to cancel your spot as soon as you can so that we can give your spot to someone on the waitlist as soon as possible. 

We're looking forward to exploring with you soon! You will receive an email with more trip specific details before the day of the trip. If you have any questions, feel free to respond to this email (it will go directly to the trip's leaders). 

${SIGNOFF}`,
});

const waitlisted = (trip) => ({
  subject: `[ACTION REQUIRED] WAITLISTED - ${trip.tripName}`,
  text: `You are currently on the waitlist for ${trip.tripName} on ${when(trip)}. While you weren't directly selected, spots open up pretty regularly and your odds of getting on the trip if you're still interested are probably better than you think. 

If you're still interested, please *confirm your interest* via the [trip page](${tripUrl(trip)}). Confirming your interest now will give you priority over all other waitlisted participants who have not done so. 

If you do not end up with a spot on the trip, we're sorry we weren't able to bring you with us! To compensate, your odds of getting on the next trip you sign up for will be increased.

${SIGNOFF}`,
});

const notSelected = (trip) => ({
  subject: `Status Update: ${trip.tripName}`,
  text: `Unfortunately you were not selected for ${trip.tripName} on ${when(trip)}, and you didn't make the waitlist either. Sorry about that.

We're sorry we weren't able to bring you with us; to compensate, your odds of getting on the next trip you sign up for are increased. Feel free to take a look at what we have coming up on our [trips page](${SITE}/trips). 

${SIGNOFF}`,
});

const promoted = (trip) => ({
  subject: `[ACTION REQUIRED] SELECTED - ${trip.tripName}`,
  text: `A spot opened up, and you have been pulled off of the waitlist for ${trip.tripName} on ${when(trip)}!

If you have not already done so, please *inform us of your continued interest by confirming* on the [trip page](${tripUrl(trip)}). If significant time passes without confirmation, it is possible for your spot to be handed to someone else on the waitlist. If you are no longer interested, please cancel your spot on the same page so we can give it to someone else.

We're looking forward to exploring with you soon! You will receive an email with more trip specific details before the day of the trip. If you have any questions, feel free to respond to this email (it will go directly to the trip's leaders). 

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
