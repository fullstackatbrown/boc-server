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
  subject: `You're on the trip: ${trip.tripName}`,
  text: `Good news - you were selected for ${trip.tripName} on ${when(trip)}.

Head to the trip page to confirm your spot and take care of anything still
outstanding, like payment or a waiver:

  ${tripUrl(trip)}

If you can no longer make it, please cancel there as soon as you can so that
someone on the waitlist can take your place.

${SIGNOFF}`,
});

const waitlisted = (trip) => ({
  subject: `You're on the waitlist for: ${trip.tripName}`,
  text: `You weren't selected in the lottery for ${trip.tripName} on ${when(trip)},
but you are on the waitlist - spots open up regularly when people cancel.

Confirm your interest on the trip page and you'll be first in line if one does:

  ${tripUrl(trip)}

Not being selected doesn't count against you. It raises your odds the next time
you enter a lottery.

${SIGNOFF}`,
});

const notSelected = (trip) => ({
  subject: `Lottery results for: ${trip.tripName}`,
  text: `Unfortunately you weren't selected for ${trip.tripName} on ${when(trip)},
and the waitlist for this trip is already full.

This isn't the end of the road. Not being selected raises your odds in future
lotteries, so entering again genuinely helps. Everything we have coming up is here:

  ${SITE}/trips

${SIGNOFF}`,
});

const promoted = (trip) => ({
  subject: `A spot opened up: ${trip.tripName}`,
  text: `A spot opened up, and you're on ${trip.tripName} on ${when(trip)}.

Please confirm on the trip page and handle anything still outstanding, like
payment or a waiver:

  ${tripUrl(trip)}

If you can't make it after all, cancel there so we can pass the spot along.

${SIGNOFF}`,
});

const thanks = (trip) => ({
  subject: `Thanks for coming on ${trip.tripName}`,
  text: `Thanks for coming out on ${trip.tripName}. We hope it was a good one.

Everything else we have coming up is here:

  ${SITE}/trips

${SIGNOFF}`,
});

const noShow = (trip) => ({
  subject: `We missed you on ${trip.tripName}`,
  text: `Our records show you were signed up for ${trip.tripName} on ${when(trip)}
but didn't make it, and we didn't hear from you beforehand.

Things come up, and we understand that. But a spot nobody claims is a spot another
student could have had, so missing a trip without notice does lower your odds in
future trip lotteries.

If you know ahead of time that you can't make a trip, cancel on the trip page or
let the leaders know. That costs you nothing and frees the spot for someone on the
waitlist:

  ${tripUrl(trip)}

If you think this is a mistake, just reply to this email - the trip's leaders will
see it.

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

//Excused absences appear in neither list: they cancelled ahead of time and are
//deliberately mailed nothing.
export async function notifyAttendance(trip, { attended, noShow: noShows }) {
  const leaders = await getLeaderEmails(trip);
  await Promise.all([
    send(leaders, attended, thanks(trip)),
    send(leaders, noShows, noShow(trip)),
  ]);
}
