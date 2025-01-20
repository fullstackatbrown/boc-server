import logger from "./logger.mjs";
import sequelize from "./sequelize.mjs";
import models from './models.mjs';
const { User, Trip, TripSignUp, TripClass } = models;
import errors from './errors.mjs';
const { AuthError, NonexistenceError, InvalidDataError, IllegalOperationError } = errors;
import { Op } from "sequelize";

//Sync models with database
(async () => {
    await sequelize.sync();
    logger.log('Models successfully synced with database');
})();

// QUERY HELPER HELPERS lol

function hasFields(obj, fields) {
  return fields.every(field => obj.hasOwnProperty(field));
}

function validFields(obj, fields) {
  return Object.getOwnPropertyNames(obj).every(field => fields.includes(field));
}

function alterPc(trip, task, field, value) {
  let pcList = JSON.parse(trip.planningChecklist);
  pcList[task][field] = value;
  trip.planningChecklist = JSON.stringify(pcList);
}

// RETRIEVAL HELPERS

function getTrips() {
  const pubTrips = Trip.findAll({
    attributes: { exclude: ['id', 'planningChecklist'] },
    where: { status: 'Open' }
  });
  return pubTrips;
}

function getLeaders() {
  const leaders = User.findAll({
    attributes: ['firstName', 'lastName', 'email'],
    where: { 
      role: { [Op.regexp]: '(Admin|Leader)' },
    },
  });
  return leaders;
}

async function getUserData(user) {
  //Lazy load in signups
  const signups = await user.getTripSignUps({
    attributes: { exclude: ['userId'] }
  });
  user = user.toJSON();
  user.TripSignUps = signups;
  //Cleanse of properties we want to hide
  delete user.id;
  delete user.lotteryWeight;
  return user;
}

//TODO: Consider if trip leaders might ever want to see their trip pages as public sees them
async function getTripData(userId, tripId) {
  //Grab trip data
  let trip = await Trip.findByPk(tripId);
  //Grab user's signup data, if any
  const signup = await TripSignUp.findOne({
    where: {
      tripId: trip.id, 
      userId: userId,
    },
    attributes: { exclude: ['userId'] }
  });
  //Decide what data to send back to user based on signup status
  let userData;
  if (!signup) { //User is not on trip / userId is null (user not signed in)
    if (!(trip.status == 'Open')) { throw new AuthError("Trip is not currently public") }
    delete trip.dataValues.planningChecklist;
    userData = null;
  } else if (signup.tripRole == 'Leader') { //User is a Leader
    userData = signup.toJSON();
    //Include other leaders' names and emails
    const otherLeaderSignups = await trip.getTripSignUps({
      where: {
        tripRole: 'Leader',
        userId: { [Op.not]: userId },
      },
      include: {
        model: User,
        attributes: ['firstName', 'lastName', 'email'],
      }
    });
    const otherLeaders = otherLeaderSignups.map(signup => signup.User);
    trip.setDataValue('otherLeaders', otherLeaders);
    if (['Pre-Trip','Post-Trip', 'Complete'].includes(trip.status)) {
      //Include all signed up participants' trip data
      const participants = await trip.getTripSignUps({
        where: { 
          status: { [Op.regexp]: '^(Selected|Participated|No Show)$' }
        }
      });
      trip.setDataValue('participants', participants);
    }
  } else { //User is a Participant
    delete trip.dataValues.planningChecklist;
    userData = signup.toJSON();
  }
  trip.setDataValue('userData', userData);
  return trip;
}

// SUBMISSION HELPERS

//Will return rejected promise if first or last name is too long or email is not valid
function createUser(firstName, lastName, email) {
  return User.create({
    firstName: firstName, 
    lastName: lastName,
    email: email,
    role: 'Participant'
  });
}

async function addPhone(user, phoneNum) {
  phoneNum = String(phoneNum).replace(/[^0-9]/g, ""); //Removes all non-numeric characters (whitespace, parens, dashes, etc.)
  user.phone = phoneNum;
  return user.save();
}

//TODO: return leaders on trip as well
const tripCreationFields = ['leaders','tripName','plannedDate','maxSize','class','priceOverride','sentenceDesc','blurb'];
async function createTrip(leader, tripJson) {
  //Sanitize/parse input
  if (!hasFields(tripJson, tripCreationFields)) throw new InvalidDataError('At least one required field is missing. Even fields with null values must be defined.');
  let { leaders, ...tripObj } = tripJson;
  if (!Array.isArray(leaders)) throw new InvalidDataError('leaders field not an array');
  //Gather (and certify existence of) all involved leaders' objects
  let leaderObjs = leaders.map((email) => { 
    return User.findOne({
      where: { 
        email: email,
        role: { [Op.regexp]: '(Admin|Leader)' }
      }
    });
  });
  leaderObjs.push(leader);
  leaderObjs = await Promise.all(leaderObjs)
  if (!leaderObjs.every(leaderObj => leaderObj)) throw new InvalidDataError('At least one specified leader doesn\'t exist');
  leaderObjs = [... new Set(leaderObjs)]; //Eliminate duplicates
  //Begin transaction
  const trans = await sequelize.transaction();
  try {
    //Create trip
    const trip = await Trip.create(tripObj);
    //Add each leader as such to the trip
    let signupProms = leaderObjs.map(leaderObj => {
      return TripSignUp.create({
        userId: leaderObj.id,
        tripId: trip.id,
        tripRole: 'Leader',
      })
    });
    await Promise.all(signupProms);
    //Commit successful changes
    await trans.commit(); 
    return trip;
  } catch (err) { //Rollback and rethrow error on failure
    await trans.rollback(); 
    throw err;
  }
}

const taskUpdateFields = ['task','responsible','complete'];
const autoTasks = ['Lottery', 'Attendance'];
async function taskUpdate(trip, taskJson) {
  //Sanitize input
  if (!hasFields(taskJson, taskUpdateFields)) throw new InvalidDataError("Missing one or more required field");
  let {task, ...taskData} = taskJson;
  let pcList = JSON.parse(trip.planningChecklist);
  if (!pcList[task]) throw new InvalidDataError("Specified task doesn't exist");
  if (typeof taskData.responsible !== "string" || typeof taskData.complete !== "boolean") throw new InvalidDataError("Field values of wrong type"); //Types must be checked manually here
  if (autoTasks.includes(task) && taskData.complete !== pcList[task].complete) throw new IllegalOperationError("Cannot alter completion status of specified task (it is performed automatically)")
  //Update task
  Object.assign(pcList[task], taskData);
  if (Object.values(pcList).every(tsk => tsk.complete)) trip.status = 'Complete';
  trip.planningChecklist = JSON.stringify(pcList);
  return trip.save();
}

let tripUpdateFields = [...(tripCreationFields.slice(1))];
async function tripUpdate(trip, alterJson) {
  //Sanitize
  if (!validFields(alterJson, tripUpdateFields)) throw new InvalidDataError("Some provided fields invalid");
  if ((alterJson.class || alterJson.priceOverride) && (trip.status !== 'Staging')) throw new InvalidDataError("Can't change trip pricing once out of Staging");
  if (['Pre-Trip','Post-Trip','Complete'].includes(trip.status) && !((alterJson.keys().length == 1) && (alterJson.plannedDate))) {
    throw new InvalidDataError("Cannot change any trip properties besides plannedDate after reaching Pre-Trip status")
  }
  //Update trip
  Object.assign(trip, alterJson);
  return trip.save();
}

async function openTrip(trip) {
  if (!(trip.status == 'Staging')) throw new IllegalOperationError("Cannot change status to Open unless status is currently Staging");
  if (!trip.sentenceDesc || !trip.blurb) throw new IllegalOperationError("Cannot change status to Open unless blurb and sentenceDesc are complete");
  trip.status = 'Open';
  return trip.save();
}

const REJECTIONBUF = 0.25;
async function runLottery(trip) {
  const signups = await trip.getTripSignUps({
    where: { tripRole: 'Participant' },
    include: User,
  });
  trip.TripSignUps = signups;
  if (trip.status !== 'Open') throw new IllegalOperationError("Cannot run lottry unless trip status is currently Open");
  //Let the games begin!!! Run lottery
  let lotteryPairs = trip.TripSignUps.map((signup, idx) => {
    let lotteryNum = signup.User.lotteryWeight * (Math.random() * 100);
    return [lotteryNum, idx];
  });
  lotteryPairs.sort((pair1, pair2) => pair2[0] - pair1[0]);
  let greatest_constraint = Math.min(trip.maxSize, lotteryPairs.length);
  let winnaWinnas = lotteryPairs.splice(0, greatest_constraint); //Leftovers are losers
  let wompWomps = lotteryPairs.splice(0,lotteryPairs.length); //For readability
  //Handle lottery consequences
  let winnaEmails = [];
  let wompEmails = [];
  let winnaProms = winnaWinnas.map(w => { //Recall w[0] is lottery # and w[1] is index
    const signup = trip.TripSignUps[w[1]];
    signup.status = 'Selected';
    const user = signup.User;
    if (user.lotteryWeight > 1) user.lotteryWeight = 1; // Reset elevated lotteryWeights to 1
    winnaEmails.push(user.email);
    return [user.save(), signup.save()];
  }).flat();
  let wompProms = wompWomps.map(l =>{
    const signup = trip.TripSignUps[l[1]];
    signup.status = 'Not Selected';
    const user = signup.User;
    user.lotteryWeight += REJECTIONBUF;
    wompEmails.push(user.email);
    return [user.save(), signup.save()];
  }).flat();
  trip.status = 'Pre-Trip';
  alterPc(trip, 'Lottery', 'complete', true);
  await Promise.all(winnaProms.concat(wompProms));
  await trip.save();
  return {
    accepted: winnaEmails,
    notAccepted: wompEmails,
  }
}

//TODO: encapsulate database manipulation in transaction
const attendanceStates = ['Participated','Excused Absence', 'No Show'];
const NOSHOWPENALTY = 0.25;
async function doAttendance(trip, attendanceJson) {
  if (!((trip.status == 'Pre-Trip') && (trip.plannedDate < new Date()))) throw new IllegalOperationError("Attendance may only be taken after lottery has been ran and after trip's planned date")
  //Sanitize attendanceJson and fetch data
  if (!Object.values(attendanceJson).every(val => attendanceStates.includes(val))) throw new InvalidDataError("At least one improper attendance state supplied");
  const signups = await trip.getTripSignUps({
    where: { status: 'Selected' },
    include: User,
  });
  trip.TripSignUps = signups;
  let emails = trip.TripSignUps.map(signup => signup.User.email);
  if (!hasFields(attendanceJson, emails) || !validFields(attendanceJson, emails)) throw new IllegalOperationError("Attendance must be reported for all accepted participants (and only accepted participants) at once");
  //Change attendance of each participant and increment status of trip
  let attendProms = trip.TripSignUps.map(signup => {
    let attendance = attendanceJson[signup.User.email];
    switch (attendance) {
      case 'Participated':
        signup.status = 'Attended';
        signup.User.tripsParticipated += 1;
        return [signup.User.save(), signup.save()];
      case 'Excused Absence':
        return signup.destroy(); //If they canceled, delete signup instance
      case 'No Show':
        signup.status = 'No Show';
        signup.User.lotteryWeight -= NOSHOWPENALTY;
        return [signup.User.save(), signup.save()];
    }
  }).flat();
  trip.status = 'Post-Trip';
  alterPc(trip, 'Lottery', 'complete', true);
  await Promise.all(attendProms);
  return trip.save()
}

async function tripSignup(userId, tripId) {
  const signup = TripSignUp.create({
    userId: userId,
    tripId: tripId,
    tripRole: 'Participant',
  });
  return signup;
}

//TODO: add and test route
async function confirmSignup(userId, tripId) {

}

//TODO: add and test route
async function alterRole(userId, emailOfUserToAlter, newRole) {
  if (!['Admin', 'Leader', 'Pariticipant'].includes(newRole)) { throw new Error("Role to elevate to doesn't exist") }
  let alteringUser = await User.findByPk(userId);
  if (alteringUser.role == 'Admin') {
    let userToAlter = await User.findOne({
      where: {
        email: emailOfUserToAlter
      }
    });
    userToAlter.role = newRole;
    return userToElevate.save();
  } else {
    throw new AuthError();
  }
}

export default { getTrips, getLeaders, getUserData, getTripData, createUser, addPhone, createTrip, taskUpdate, tripUpdate, openTrip, runLottery, doAttendance, tripSignup };