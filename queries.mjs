import logger from "./logger.mjs";
import sequelize from "./sequelize.mjs";
import models from "./models.mjs";
const { User, Trip, TripSignUp, TripClass } = models;
import errors from "./errors.mjs";
import { promises as fs } from "fs";
const {
  AuthError,
  NonexistenceError,
  InvalidDataError,
  IllegalOperationError,
} = errors;
import { Op } from "sequelize";

//Sync models with database
(async () => {
  await sequelize.sync();
  logger.log("Models successfully synced with database");
})();

// QUERY HELPER HELPERS lol

function hasFields(obj, fields) {
  return fields.every((field) => obj.hasOwnProperty(field));
}

function validFields(obj, fields) {
  return Object.getOwnPropertyNames(obj).every((field) =>
    fields.includes(field),
  );
}

function alterPc(trip, task, field, value) {
  let pcList = JSON.parse(trip.planningChecklist);
  pcList[task][field] = value;
  trip.planningChecklist = JSON.stringify(pcList);
}

// RETRIEVAL HELPERS

function getTrips() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed

  let semesterStart, semesterEnd;
  if (month >= 1 && month <= 5) {
    semesterStart = `${year}-01-01`;
    semesterEnd = `${year}-05-31`;
  } else if (month >= 9 && month <= 12) {
    semesterStart = `${year}-09-01`;
    semesterEnd = `${year}-12-31`;
  } else {
    return Promise.resolve([]);
  }

  return Trip.findAll({
    attributes: { exclude: ["planningChecklist"] },
    where: {
      status: { [Op.ne]: "Staging" },
      plannedDate: { [Op.between]: [semesterStart, semesterEnd] },
    },
  });
}

function getLeaders() {
  const leaders = User.findAll({
    attributes: ["firstName", "lastName", "email"],
    where: {
      role: { [Op.regexp]: "(Admin|Leader)" },
    },
  });
  return leaders;
}

function getBasicUserData(user) {
  //Cleanse of properties we want to hide
  user = user.toJSON()
  delete user.id;
  delete user.lotteryWeight;
  return user;
}

async function getUserData(user) {
  //Lazy load in signups
  const signups = await user.getTripSignUps({
    attributes: { exclude: ["userId"] },
  });
  user = user.toJSON();
  user.TripSignUps = signups;
  //Cleanse of properties we want to hide
  delete user.id;
  delete user.lotteryWeight;
  return user;
}

//TODO: Consider if trip leaders might ever want to see their trip pages as public sees them
async function getTripData(tripId, userId) {
  //Grab trip and signup data
  let trip = await Trip.findByPk(tripId);
  if (!trip) throw new NonexistenceError("There is no trip associated with the requested trip ID")
  const signup = (
    userId
    ? await TripSignUp.findOne({ //May also return null, if no such signup exists
      where: {
        tripId: trip.id,
        userId: userId,
      },
      attributes: { exclude: ["userId"] },
    }) 
    : null
  );
  // Add leader data to trip
  const leaderSignups = await trip.getTripSignUps({
    where: {
      tripRole: "Leader",
    },
    include: {
      model: User,
      attributes: ["firstName", "lastName", "email"],
    },
  });
  const leaders = leaderSignups.map((signup) => signup.User);
  trip.setDataValue("leaders", leaders);
  // Determine what user data to return based on user's status wrt the trip
  let userData;
  if (signup == null) { // Not logged in or not signed up for the trip
    if (trip.status == 'Staging') {
      throw new AuthError("Trip is not currently public");
    }
    delete trip.dataValues.planningChecklist;
    userData = null;
  } else if (signup.tripRole == "Participant") {
    userData = signup.toJSON();
    delete trip.dataValues.planningChecklist;
  } else if (signup.tripRole == "Leader") {
    userData = signup.toJSON();
    if (["Pre-Trip", "Post-Trip", "Complete"].includes(trip.status)) {
      //Include all signed up participants' trip data
      const participants = await trip.getTripSignUps({
        where: {
          status: { [Op.regexp]: "^(Selected|Attended|No Show)$" },
        },
      });
      trip.setDataValue("participants", participants);
    }
  }
  trip.setDataValue("userData", userData);
  return trip;
}

// SUBMISSION HELPERS

//Will return rejected promise if first or last name is too long or email is not valid
function createUser(firstName, lastName, email) {
  return User.create({
    firstName: firstName,
    lastName: lastName,
    email: email,
    role: "Participant",
  });
}

async function addPhone(user, phoneNum) {
  phoneNum = String(phoneNum).replace(/[^0-9]/g, ""); //Removes all non-numeric characters (whitespace, parens, dashes, etc.)
  user.phone = phoneNum;
  return user.save();
}

const LISTSERV_FILE = "./listserv-additions.txt"
async function listervAdd(user) {
  if (!user.joinedListserv) {
    fs.appendFile(LISTSERV_FILE, user.email + "\n");
    user.joinedListserv = true;
    return user.save();
  }
}

//TODO: return leaders on trip as well
const tripCreationFields = [
  "leaders",
  "tripName",
  "category",
  "plannedDate",
  "plannedEndDate",
  "maxSize",
  "class",
  "priceOverride",
  "sentenceDesc",
  "blurb",
  "image",
];
async function createTrip(leader, tripJson) {
  //Sanitize/parse input
  if (!hasFields(tripJson, tripCreationFields))
    throw new InvalidDataError(
      "At least one required field is missing. Even fields with null values must be defined.",
    );
  let { leaders, ...tripObj } = tripJson;
  if (!Array.isArray(leaders))
    throw new InvalidDataError("Leaders field not an array");
  //Gather (and certify existence of) all involved leaders' objects
  let leaderObjs = leaders.map((email) => {
    return User.findOne({
      where: {
        email: email,
        role: { [Op.regexp]: "(Admin|Leader)" },
      },
    });
  });
  leaderObjs.push(leader);
  leaderObjs = await Promise.all(leaderObjs);
  if (!leaderObjs.every((leaderObj) => leaderObj))
    throw new InvalidDataError("At least one specified leader doesn't exist");
  //Eliminate duplicates
  const leaderEmails = leaderObjs.map(leader => leader.email);
  leaderObjs = leaderObjs.filter((leader, idx) => !leaderEmails.slice(0,idx).includes(leader.email) );
  //Begin transaction
  const trans = await sequelize.transaction();
  try {
    //Create trip
    const trip = await Trip.create(tripObj);
    //Add each leader as such to the trip
    let signupProms = leaderObjs.map((leaderObj) => {
      return TripSignUp.create({
        userId: leaderObj.id,
        tripId: trip.id,
        tripRole: "Leader",
      });
    });
    await Promise.all(signupProms);
    //Commit successful changes
    await trans.commit();
    return trip;
  } catch (err) {
    //Rollback and rethrow error on failure
    await trans.rollback();
    throw err;
  }
}

async function getTripParticipants(trip) {
  let participants = await trip.getUsers({
    attributes: ["firstName", "lastName", "email"],
    through: {
      where: { tripRole: "Participant" },
      // attributes: ["status", "confirmed", "paid"] - Doesn't seem to work, weirdly
    }
  });
  participants = participants.map((participant) => {
    let signup = participant.TripSignUp;
    participant = participant.toJSON();
    Object.assign(participant, {
      status: signup.status,
      confirmed: signup.confirmed,
      paid: signup.paid,
    });
    delete participant["TripSignUp"];
    return participant;
  })
  return participants;
}

async function getLeaderEmails(trip) {
  const leaders = await trip.getUsers({
    attributes: ["email"],
    through: {
      where: { tripRole: "Leader" },
    }
  });
  return leaders.map(l => l.email);
}

async function getPossibleParticipantEmails(trip) {
  const leaderEmails = await getLeaderEmails(trip);
  const possibleParticipants = await User.findAll({
    attributes: ["email"],
    where: { email : { [Op.notIn] : leaderEmails } }
  });
  return possibleParticipants.map(p => p.email);

}

const taskUpdateFields = ["task", "responsible", "complete"];
const autoTasks = ["Lottery", "Attendance"];
async function taskUpdate(trip, taskJson) {
  //Sanitize input
  if (!hasFields(taskJson, taskUpdateFields))
    throw new InvalidDataError("Missing one or more required field");
  let { task, ...taskData } = taskJson;
  let pcList = JSON.parse(trip.planningChecklist);
  if (!pcList[task]) throw new InvalidDataError("Specified task doesn't exist");
  if (
    typeof taskData.responsible !== "string" ||
    typeof taskData.complete !== "boolean"
  )
    throw new InvalidDataError("Field values of wrong type"); //Types must be checked manually here
  if (autoTasks.includes(task) && taskData.complete !== pcList[task].complete)
    throw new IllegalOperationError(
      "Cannot alter completion status of specified task (it is performed automatically)",
    );
  //Update task
  Object.assign(pcList[task], taskData);
  if (Object.values(pcList).every((tsk) => tsk.complete))
    trip.status = "Complete";
  trip.planningChecklist = JSON.stringify(pcList);
  return trip.save();
}

//waitlistSize is absent from tripCreationFields (it is optional, and hasFields demands
//every entry), but it is still alterable
let tripUpdateFields = [...tripCreationFields.slice(1), "waitlistSize", "newLeader"];
async function tripUpdate(trip, alterJson) {
  //Sanitize
  if (!validFields(alterJson, tripUpdateFields))
    throw new InvalidDataError("Some provided fields invalid");
  if ((alterJson.class || alterJson.priceOverride) && trip.status !== "Staging")
    throw new InvalidDataError("Can't change trip pricing once out of Staging");
  if (
    ["Pre-Trip", "Post-Trip", "Complete"].includes(trip.status) &&
    !(Object.keys(alterJson).length == 1 && alterJson.plannedDate)
  ) {
    throw new InvalidDataError(
      "Cannot change any trip properties besides plannedDate after reaching Pre-Trip status",
    );
  }
  //Update trip
  if (alterJson.newLeader) {
    try { await addLeader(trip, alterJson.newLeader); }
    catch (err) { throw err  } // Propogate errors so they gets properly handled 
    delete alterJson.newLeader; //Make sure newLeader doesn't foul up Object.assign
  }
  Object.assign(trip, alterJson);
  return trip.save();
}

//NEEDS ACTUAL TESTING
async function addLeader(trip, leaderEmail) { //This is an unexposed function - used by tripUpdate
  //Find leader
  let newLeader = await User.findOne({
    where: {
      email: leaderEmail,
      role: { [Op.regexp]: "(Admin|Leader)" },
    },
  });
  if (!newLeader) throw new InvalidDataError("Provided leader email invalid");
  //See if leader already has a signup and handle accordingly
  let signup = await TripSignUp.findOne({
    where: {
      userId: newLeader.id,
      tripId: trip.id,
    }
  });
  if (signup && (signup.tripRole == "Leader")) throw new InvalidDataError("Provided leader to add is already a trip leader");
  else if (signup && (signup.tripRole == "Particpant")) { //If they are currently a participant, turn them into a leader
    Object.assign(signup, {
      tripRole: "Leader",
      status: null, 
      needPaperwork: null,
      confirmed: null, 
      paid: null
    });
    return signup.save();
  } else { //There's no pre-existing signup, so let's make a new one
    return TripSignUp.create({
      userId: newLeader.id,
      tripId: trip.id,
      tripRole: "Leader",
    })
  }
}

async function openTrip(trip) {
  if (!(trip.status == "Staging"))
    throw new IllegalOperationError(
      "Cannot change status to Open unless status is currently Staging",
    );
  if (!trip.sentenceDesc || !trip.blurb)
    throw new IllegalOperationError(
      "Cannot change status to Open unless blurb and sentenceDesc are complete",
    );
  trip.status = "Open";
  return trip.save();
}

const REJECTIONBUF = 0.25;
async function runLottery(trip) {
  const signups = await trip.getTripSignUps({
    where: { tripRole: "Participant" },
    include: User,
  });
  trip.TripSignUps = signups;
  if (trip.status !== "Open")
    throw new IllegalOperationError(
      "Cannot run lottry unless trip status is currently Open",
    );
  //Let the games begin!!! Run lottery
  let lotteryPairs = trip.TripSignUps.map((signup, idx) => {
    let lotteryNum = signup.User.lotteryWeight * (Math.random() * 100);
    return [lotteryNum, idx];
  });
  lotteryPairs.sort((pair1, pair2) => pair2[0] - pair1[0]);
  let greatest_constraint = Math.min(trip.maxSize, lotteryPairs.length);
  let winnaWinnas = lotteryPairs.splice(0, greatest_constraint); //Leftovers are losers
  //A null waitlistSize means unlimited - everyone not selected waits
  let waitlisters = lotteryPairs.splice(0, trip.waitlistSize ?? lotteryPairs.length);
  let wompWomps = lotteryPairs.splice(0, lotteryPairs.length); //For readability
  //Handle lottery consequences
  let winnaEmails = [];
  let waitEmails = [];
  let wompEmails = [];
  let winnaProms = winnaWinnas
    .map((w) => {
      //Recall w[0] is lottery # and w[1] is index
      const signup = trip.TripSignUps[w[1]];
      signup.status = "Selected";
      const user = signup.User;
      if (user.lotteryWeight > 1) user.lotteryWeight = 1; // Reset elevated lotteryWeights to 1
      winnaEmails.push(user.email);
      return [user.save(), signup.save()];
    })
    .flat();
  let waitProms = waitlisters
    .map((w) => {
      const signup = trip.TripSignUps[w[1]];
      signup.status = "Waitlisted";
      const user = signup.User;
      //No effect on lottery weights for being waitlisted; can gets kicked down the road
      waitEmails.push(user.email);
      return signup.save();
    });
  let wompProms = wompWomps
    .map((l) => {
      const signup = trip.TripSignUps[l[1]];
      signup.status = "Not Selected";
      const user = signup.User;
      user.lotteryWeight += REJECTIONBUF; //Add lottery compensation for not being selected
      wompEmails.push(user.email);
      return [user.save(), signup.save()];
    })
    .flat();
  trip.status = "Pre-Trip";
  alterPc(trip, "Lottery", "complete", true);
  await Promise.all(winnaProms.concat(waitProms.concat(wompProms)));
  await trip.save();
  return {
    accepted: winnaEmails,
    waitlisted: waitEmails, 
    notAccepted: wompEmails,
  };
}

const addJsonFields = ["count"];
async function addParticipant(trip, addJson = {}) {
  if (!validFields(addJson, addJsonFields)) throw new InvalidDataError("Request body may only have the field 'count'");
  const count = addJson.count ?? 1; //No count means the old single-promotion behavior
  if (!Number.isInteger(count) || count < 1) throw new InvalidDataError("'count' must be a positive integer");
  if (trip.status != "Pre-Trip") throw new IllegalOperationError("May only pull participants from the waitlist when trip is in Pre-Trip phase");
  const waitlistedSignups = await trip.getTripSignUps({
    where: { status: "Waitlisted" },
    include: User, //So the promoted users' emails are on hand without a second query
  })
  //Confirmed waitlisters get priority, shuffled within each tier so choice stays random
  const shuffle = (l) => l.map((s) => [Math.random(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const promoted = shuffle(waitlistedSignups.filter((ws) => ws.confirmed))
    .concat(shuffle(waitlistedSignups.filter((ws) => !ws.confirmed)))
    .slice(0, count); //Clamps: fewer than requested when the waitlist runs short
  await Promise.all(promoted.map((ps) => {
    ps.status = "Selected";
    return ps.save();
  }));
  //success is just added.length, kept so older frontends can still read it
  return { success : promoted.length, added: promoted.map((ps) => ps.User.email) };
}

const removeJsonFields = ["email"];
async function removeParticipant(trip, removeJson) {
  if (!validFields(removeJson, removeJsonFields)) throw new InvalidDataError("Request body must just have the field 'email'");
  if (trip.status != "Pre-Trip") throw new IllegalOperationError("May only remove participants from a trip when the trip is in Pre-Trip phase");
  //Find user
  const user = await User.findOne({
    where: {
      email: removeJson.email,
    }
  });
  if (!user) throw new InvalidDataError("Specified email does not belong to an existing account");
  //Find signup
  const signup = await TripSignUp.findOne({
    where: { 
      userId: user.id,
      tripId: trip.id,
      status: "Selected",
     }
  });
  if (!signup) throw new InvalidDataError("Specified email does not belong to an account that is selected for this trip");
  //Change signup status
  signup.status = "Not Selected";
  return signup.save();
}

async function runTrip(trip) {
  const todaysDateonly = new Date().toISOString().slice(0, 10);
  if (!(trip.status == "Pre-Trip" && trip.plannedDate <= todaysDateonly)) throw new IllegalOperationError("Trip may not be run before its planned date and must be in Pre-Trip state");
  //Move all participants still on the waitlist to Not Selected
  const waitlistedSignups = await trip.getTripSignUps({
    where: { 
      status: "Waitlisted",
      //include: User 
    }
  });
  let proms = waitlistedSignups.map(async (ws) => {
    ws.status = "Not Selected";
    if (ws.confirmed) { //DESIGN CHOICE: Only buff the lottery chances of those who confirmed interest
      const user = await ws.getUser();
      user.lotteryWeight += REJECTIONBUF;
      return Promise.all([ws.save(), user.save()]);
    }
    return ws.save();
  });
  //DESIGN CHOICE: Don't jettison off all users who haven't confirmed - leave that to trip leader's discretion
  trip.status = "Post-Trip";
  proms.push(trip.save());
  return Promise.all(proms);
}

//Cancels a trip outright, destroying it and every signup on it. Recipient lists are
//gathered BEFORE the delete, since afterwards there is nothing left to query.
async function cancelTrip(trip) {
  if (!["Staging", "Open", "Pre-Trip"].includes(trip.status))
    throw new IllegalOperationError(
      "May only cancel a trip while it is in Staging, Open, or Pre-Trip status",
    );
  //Staging trips have no participants, so this comes back empty and nobody is mailed.
  //Not Selected participants are left out - they have already been told they're off.
  const participantSignups = await trip.getTripSignUps({
    where: trip.status == "Pre-Trip"
      ? { tripRole: "Participant", status: { [Op.in]: ["Selected", "Waitlisted"] } }
      : { tripRole: "Participant" },
    include: User,
  });
  const leaders = await getLeaderEmails(trip);
  const recipients = participantSignups.map((signup) => signup.User.email);
  const trans = await sequelize.transaction();
  try {
    //DESIGN CHOICE: same rule runTrip uses - only those who confirmed interest get the
    //lottery buff back, since the cancellation cost them a spot they'd committed to
    for (const signup of participantSignups.filter((s) => s.confirmed)) {
      signup.User.lotteryWeight += REJECTIONBUF;
      await signup.User.save({ transaction: trans });
    }
    //Destroyed sequentially - concurrent destroys on one trip intermittently fail with
    //MariaDB 1020 (see destroyer.mjs and server_jobs.mjs, which hit the same thing)
    const signups = await trip.getTripSignUps({ transaction: trans });
    for (const signup of signups) await signup.destroy({ transaction: trans });
    await trip.destroy({ transaction: trans });
    await trans.commit();
  } catch (err) {
    await trans.rollback();
    throw err;
  }
  return { leaders, recipients };
}

async function attendAdditionalParticipants(additionalParticipantEmails, selectedParticipantEmails, trip, trans) {
  //Check to make sure input emails are valid
  const possibleParticipantEmails = await getPossibleParticipantEmails(trip);
  if (!additionalParticipantEmails.every(e => possibleParticipantEmails.includes(e))) throw new InvalidDataError("Attendance cannot be taken for an email not registered with a user (or an email registered with a trip leader's account).");
  //Filter out any potential duplicates between additional and selected participants emails
  additionalParticipantEmails = additionalParticipantEmails.filter(e => !selectedParticipantEmails.includes(e));
  //Find users associated with each additional participant email
  const users = await User.findAll({ where: { email: additionalParticipantEmails }, transaction: trans });
  //A walk-on may already hold a signup on this trip (waitlisted, not selected, removed),
  //and (tripId, userId) is the primary key - so those are updated rather than recreated
  const existing = await TripSignUp.findAll({ where: { tripId: trip.id, userId: users.map(u => u.id) }, transaction: trans });
  const attended = { status: "Attended", confirmed: true };
  //Mark each additional participant attended and increment their trips attended
  const proms = users.map(u => {
    u.tripsParticipated += 1;
    u.lotteryWeight = 1;
    const signup = existing.find(s => s.userId === u.id);
    return [
      u.save({ transaction: trans }),
      signup ? signup.update(attended, { transaction: trans })
             : TripSignUp.create({ userId: u.id, tripId: trip.id, tripRole: "Participant", ...attended }, { transaction: trans }),
    ];
  });
  return Promise.all(proms.flat());
}

const attendanceStates = ["Attended", "Excused Absence", "No Show"];
const attendenceJsonFields = ["selectedParticipants", "additionalParticipants"];
const NOSHOWPENALTY = 0.25;
async function doAttendance(trip, attendanceJson) {
  if (!(hasFields(attendanceJson, attendenceJsonFields) && validFields(attendanceJson, attendenceJsonFields))) throw new InvalidDataError("Attendance JSON does not contain the proper fields.")
  const selectedParticipants = attendanceJson.selectedParticipants;
  const additionalParticipants = attendanceJson.additionalParticipants;
  //
  //HANDLE SELECTED PARTICIPANTS
  //
  if (!(trip.status == "Post-Trip" && new Date(trip.plannedDate) <= new Date(new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" })))) { //Heinous timezone nonsense - might need more testing
    throw new IllegalOperationError(
      "Attendance may only be taken after lottery has been ran and on/after trip's planned date",
    );
  }
  //Sanitize selectedParticipants and fetch data
  if (!Object.values(selectedParticipants).every((val) => attendanceStates.includes(val)))
    throw new InvalidDataError(
      "At least one improper attendance state supplied",
    );
  const signups = await trip.getTripSignUps({
    where: { status: "Selected" },
    include: User,
  });
  trip.TripSignUps = signups;
  let emails = trip.TripSignUps.map((signup) => signup.User.email);
  if (
    !hasFields(selectedParticipants, emails) ||
    !validFields(selectedParticipants, emails)
  )
    throw new IllegalOperationError(
      "Attendance must be reported for all accepted participants at once",
    );
  //Every write below shares one transaction: a failure midway (say, a walk-on's
  //signup colliding) must not leave some signups attended and the trip still Post-Trip
  await sequelize.transaction(async (trans) => {
    //Take attendance of additional participants
    const additionalAttendanceProm = attendAdditionalParticipants(additionalParticipants, emails, trip, trans);
    //Change attendance of each participant and increment status of trip
    let attendProms = trip.TripSignUps.map((signup) => {
      let attendance = selectedParticipants[signup.User.email];
      switch (attendance) {
        case "Attended":
          signup.status = "Attended";
          signup.User.tripsParticipated += 1;
          signup.User.lotteryWeight = 1;
          return [signup.User.save({ transaction: trans }), signup.save({ transaction: trans })];
        case "Excused Absence":
          return signup.destroy({ transaction: trans }); //If they canceled, delete signup instance
        case "No Show":
          signup.status = "No Show";
          signup.User.lotteryWeight -= NOSHOWPENALTY;
          return [signup.User.save({ transaction: trans }), signup.save({ transaction: trans })];
      }
    }).flat();
    //Increment trips lead for trip leaders and change trip status to complete
    const leaders = await trip.getUsers({
      through: {
        where: { tripRole: "Leader" },
      },
      transaction: trans,
    });
    const tripsLeadIncrProms = leaders.map(l => {
      l.tripsLead += 1;
      return l.save({ transaction: trans });
    })
    trip.status = "Complete";
    //alterPc(trip, "Attendance", "complete", true);
    attendProms.push(...tripsLeadIncrProms, additionalAttendanceProm);
    await Promise.all(attendProms);
    await trip.save({ transaction: trans });
  });
  //Report who ended up where so callers don't have to re-derive it from the request.
  //Walk-ons already on the selected list keep the status given there, matching the
  //filter attendAdditionalParticipants applies - otherwise a selected No Show typed
  //into the walk-on box would count as both.
  const byState = (state) => emails.filter((e) => selectedParticipants[e] === state);
  const walkOns = additionalParticipants.filter((e) => !emails.includes(e));
  //Excused absences are omitted: their signups were just deleted
  return { attended: [...byState("Attended"), ...walkOns], noShow: byState("No Show") };
}

async function tripSignup(userId, tripId) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw new NonexistenceError("Trip at specified tripId doesn't exist");
  if (trip.status !== "Open") throw new IllegalOperationError("Can only sign up for trips that are currently Open");
  //Check to see if there was already a signup
  const prevSignup = await TripSignUp.findOne({
    where: {
      userId: userId,
      tripId: tripId
    }
  });
  if (prevSignup) {
    logger.log("Attempted resignup for a user already signed up for a trip");
    return prevSignup;
  }
  //Make the signup if not
  const signup = TripSignUp.create({
    userId: userId,
    tripId: tripId,
    tripRole: "Participant",
  });
  return signup;
}

//Assumes userId is non-null
async function isSignedUp(userId, tripId) {
  const signup = await TripSignUp.findOne({
    where: {
      userId: userId,
      tripId: tripId,
    },
  });
  return !signup ? false : true;
}

async function confirmSignup(signup) {
  signup.confirmed = true;
  return signup.save()
}

async function cancelSignup(signup) {
  return signup.destroy()
}

//What a participant owes. Needs the trip's TripClass included.
function tripPrice(trip) {
  return trip.priceOverride ?? trip.TripClass?.price;
}

//Trips that ran between the two dates (inclusive; by end date for multi-day trips) whose
//attended participants still owe money, as [{ trip, unpaid: [{ firstName, lastName,
//email }] }]. Free and fully paid trips are left out, so this is exactly the set that
//needs a payment reminder (see remindPayments in server_jobs.mjs).
async function getUnpaidAttendance(fromDate, toDate) {
  const ended = { [Op.between]: [fromDate, toDate] };
  const trips = await Trip.findAll({
    where: {
      status: "Complete", //Attendance has been taken
      [Op.or]: [{ plannedEndDate: ended }, { plannedEndDate: null, plannedDate: ended }],
    },
    include: [
      TripClass,
      {
        model: User,
        attributes: ["firstName", "lastName", "email"],
        through: { where: { tripRole: "Participant", status: "Attended", paid: false } },
        required: true, //Drops trips with nobody unpaid
      },
    ],
  });
  return trips
    .filter((trip) => tripPrice(trip) > 0)
    .map((trip) => ({ trip, unpaid: trip.Users.map(({ firstName, lastName, email }) => ({ firstName, lastName, email })) }));
}

//Records a Brown Marketplace payment (see payments/receipt.mjs) against the signup it
//most plausibly covers. A receipt names a buyer and a unit price but never a trip, so:
//the buyer's Participant signups that are Selected or Attended, unpaid, and on a trip
//costing exactly unitPrice (class price or override), oldest trip first. That is nearly
//always one signup; when it isn't, the buyer owes for both anyway and which is marked
//first doesn't matter. altEmail is the store's optional form field, tried only when the
//checkout address matches no user. Returns the signups marked - empty when nothing
//matched, in which case the receipt is simply disregarded: paying from an address the
//site doesn't know is the participant's problem to sort out with an admin.
//A multi-item cart is first tried as one payment of cartTotal, since trips priced above
//any single item are bought as two items in one cart. Idempotent when both products
//notify: the second email finds no unpaid trip at the cart total and falls through to
//unitPrice. Accepted edge: a buyer with such a trip AND another unpaid trip at one of
//the item prices could have the second email mark the other trip - they owe for both.
//`options` is passed through to Sequelize so tests can run inside a transaction.
async function applyPayment({ email, altEmail, unitPrice, quantity = 1, cartTotal }, options = {}) {
  let user = await User.findOne({ where: { email }, ...options });
  if (!user && altEmail) user = await User.findOne({ where: { email: altEmail }, ...options });
  if (!user) return [];
  const signups = await TripSignUp.findAll({
    where: {
      userId: user.id,
      tripRole: "Participant",
      status: { [Op.in]: ["Selected", "Attended"] },
      paid: false,
    },
    include: { model: Trip, include: TripClass },
    order: [[Trip, "plannedDate", "ASC"]],
    ...options,
  });
  const at = (amount) => signups.filter((signup) => Math.abs(tripPrice(signup.Trip) - amount) < 0.005); //FLOAT column
  let matched = [];
  if (cartTotal != null && Math.abs(cartTotal - unitPrice * quantity) >= 0.005) matched = at(cartTotal).slice(0, 1);
  if (!matched.length) matched = at(unitPrice).slice(0, quantity);
  for (const signup of matched) {
    signup.paid = true;
    await signup.save(options);
  }
  return matched;
}

//TODO: add and test route
async function alterRole(userId, emailOfUserToAlter, newRole) {
  if (!["Admin", "Leader", "Pariticipant"].includes(newRole)) {
    throw new Error("Role to elevate to doesn't exist");
  }
  let alteringUser = await User.findByPk(userId);
  if (alteringUser.role == "Admin") {
    let userToAlter = await User.findOne({
      where: {
        email: emailOfUserToAlter,
      },
    });
    userToAlter.role = newRole;
    return userToElevate.save();
  } else {
    throw new AuthError();
  }
}

export default {
  getTrips,
  getLeaders,
  getBasicUserData,
  getUserData,
  getTripData,
  createUser,
  addPhone,
  createTrip,
  getTripParticipants, 
  getPossibleParticipantEmails,
  getLeaderEmails,
  taskUpdate,
  tripUpdate,
  openTrip,
  runLottery,
  addParticipant,
  removeParticipant,
  runTrip,
  cancelTrip,
  doAttendance,
  tripSignup,
  isSignedUp,
  confirmSignup,
  cancelSignup,
  applyPayment,
  getUnpaidAttendance,
  tripPrice,
  listervAdd,
};
