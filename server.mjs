import logger from "./logger.mjs";

//Handle global errors without shutting the whole program down
/*
process.on("unhandledRejection", (reason, promise) => {
  let trace = '';
  if (reason instanceof Error) { trace = reason.stack } 
  let err_msg = `FAILED PROMISE: ${promise} occurred because ${reason}\n${trace}`;
  console.error(err_msg);
  logger.log(err_msg);
});
process.on("uncaughtException", (reason, exception_origin) => {
  let trace = '';
  if (reason instanceof Error) { trace = reason.stack } 
  let err_msg = `EXCEPTION THROWN: ${exception_origin} occurred because ${reason}\n${trace}`;
  console.error(err_msg);
  logger.log(err_msg);
})
*/

//
//QUERY HELPERS
//

import sequelize from "./sequelize.mjs";
import models from './models.mjs';
const { User, Trip, TripSignUp, TripClass } = models;
import errors from './errors.mjs';
const { AuthError, NonexistenceError, InvalidDataError } = errors;
import { Sequelize } from "sequelize";

//Sync models with database
await sequelize.sync();
logger.log('Models successfully synced with database');

// QUERY HELPER HELPERS lol

function hasFields(obj, fields) {
  return fields.every(field => obj.hasOwnAttribute(field));
}

function validFields(obj, fields) {
  return obj.getAttributeNames().every(field => fields.includes(field));
}

async function isTripLeader(userId, tripId) { //Has benefit of certifying tripId's validity
  let signup = await TripSignUp.findOne({
    where: {
      userId: userId,
      tripId: tripId,
    }
  });
  return (signup && (signup.tripRole == 'Leader'))
}

// RETRIEVAL HELPERS

function getTrips() {
  let pubTrips = Trip.findAll({
    attributes: { exclude: ['id', 'planningChecklist'] },
    where: { status: 'Open' }
  });
  return pubTrips;
}

function getUserData(userId) {
  let user = User.findByPk(userId, {
    attributes: { exclude: ['id', 'lotteryWeight'] },
    include: {
      model: TripSignUp,
      attributes: { exclude: ['userId'] },
    }
  });
  return user;
}

//TODO: Consider if trip leaders might ever want to see their trip pages as public sees them
async function getTripData(userId, tripId) {
  //Grab trip data, if tripId is valid - error if not
  let trip = await Trip.findByPk(tripId);
  if (!trip) { throw new NonexistenceError() }
  else { trip = trip.toJSON() }
  //Grab signup data
  let signup = await TripSignUp.findOne({
    where: {
      tripId: tripId, 
      userId: userId,
    },
    attributes: { exclude: ['userId'] }
  });
  //Decide what data to send back to user based on signup status
  let userData;
  if (!signup) { //User is not on trip / userId is null (user not signed in)
    if (!(trip.status == 'Open')) { throw new AuthError("Trip is not currently public") }
    delete trip.planningChecklist;
    userData = null;
  } else if (signup.tripRole == 'Leader') { //User is a Leader
    userData = signup.toJSON();
  } else { //User is a Participant
    delete trip.planningChecklist;
    userData = signup.toJSON();
  }
  trip.userData = userData;
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

async function addPhone(userId, phoneNum) {
  phoneNum = phoneNum.replace(/[^0-9]/g, ""); //Removes all non-numeric characters (whitespace, parens, dashes, etc.)
  let user = await User.findByPk(userId);
  user.phone = phoneNum;
  return user.save();
}

const tripCreationFields = ['leaders','tripName','plannedDate','maxSize','class','priceOverride','sentenceDesc','blurb'];
async function createTrip(userId, tripJson) {
  //Sanitize/parse input
  if (!hasFields(tripJson, tripCreationFields)) throw InvalidDataError('At least one required field is missing. Even fields with null values must be defined.');
  let { leaders, ...tripObj } = tripJson;
  if (!Array.isArray(leaders)) throw InvalidDataError('leaders field not an array');
  //Gather (and certify existence of) all involved leaders' objects
  let creatingLeader = User.findByPk(userId);
  if (!creatingLeader || !(['Admin','Leader'].includes(creatingLeader.role))) throw AuthError()
  let leaderObjs = leaders.map((email) => { 
    return User.findOne({
      where: { email: email }
    });
  });
  leaderObjs.push(creatingLeader);
  leaderObjs = await Promise.all(leaderObjs)
  if (!leaderObjs.every(leaderObj => leaderObj)) throw InvalidDataError('At least one specified leader doesn\'t exist');
  leaderObjs = [... new Set(leaderObjs)]; //Eliminate duplicates
  //Begin transaction
  await sequelize.transaction();
  try {
    //Create trip
    let trip = await Trip.create(tripObj);
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
    await sequelize.commit(); 
    return trip;
  } catch (err) { //Rollback and rethrow error on failure
    await sequelize.rollback(); 
    throw err;
  }
}

const taskUpdateFields = ['tripId','task','responsible','complete']
async function taskUpdate(tripId, taskJson) {
  //Sanitize input
  if (!hasFields(taskJson, taskUpdateFields)) throw InvalidDataError("Missing one or more required field");
  let {task, ...taskData} = taskJson;
  let trip = await Trip.getByPk(tripId);
  if (!trip.planningChecklist[task]) throw InvalidDataError("Specified task doesn't exist");
  if (typeof taskData.responsible !== "string" || typeof taskData.complete !== "boolean") throw InvalidDataError("Field values of wrong type"); //Types must be checked manually here
  //Update task
  Object.assign(trip.planningChecklist[task], taskData);
  return trip.save();
}

const tripUpdateFields = [...tripCreationFields];
async function tripUpdate(tripId, alterJson) {
  //Sanitize
  if (!validFields(alterJson, tripUpdateFields)) throw InvalidDataError("Some provided fields invalid");
  let trip = await Trip.getByPk(tripId);
  if ((alterJson.class || alterJson.priceOverride) && (trip.status !== 'Staging')) throw new InvalidDataError("Can't change trip pricing once out of Staging");
  if (['Pre-Trip','Post-Trip','Complete'].includes(trip.status) && !((alterJson.keys().length == 1) && (alterJson.plannedDate))) {
    throw new InvalidDataError("Cannot change any trip properties besides plannedDate after reaching Pre-Trip status")
  }
  //Update trip
  Object.assign(trip, alterJson);
  return trip.save();
}

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


//
//MIDDLEWARE
//

//Logs method and origin of incoming requests
async function logRequest(req, _res, next) {
  logger.log(`${req.method} request for ${req.path} received from ${req.connection.remoteAddress}:${req.connection.remotePort}`);
  next();
}

//Checks authentication of incoming requests
async function authenticate(req, res, next) {
  const token = req.cookies.access_token;
  if (!token) { //No auth token yet - front end should treat this as a sign, so start google auth process
    logger.log(`Authentication failed for ${req.connection.remoteAddress}:${req.connection.remotePort}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" }); 
  }
  try {
    // Use the token to fetch data from an external API
    const response = await axios.get(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch protected data:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
  //If no error occurs, it's safe to continue
  //res.json(response.data);
  next();
}

const TESTID = null;
function phonyAuth(req, _res, next) {
  req.userId = TESTID;
  next();
}

function loggedIn(req, _res, next) {
  if (!req.userId) throw new AuthError();
  next();
}

function parseTripId(req, _res, next) {
  let tripId = parseInt(req.params.tripId.split('-')[1]);
  if (Number.isNaN(tripId)) throw new NonexistenceError("Trip signature improperly formed");
  req.tripId = tripId;
  next();
}

async function tripLeaderCheck(req, _res, next) {
  if (!(await isTripLeader(req.userId, req.tripId))) throw new AuthError("Must be a trip leader to post to this route");
  next();
}

//Error handling utility
const asyncHandler = (handler) => { //Ugly wrapper to aid with error/rejected promise propogation
  return async (req, res, next) => {
    try { await handler(req, res) }
    catch (err) { next(err) }
  }
}

//Express app setup
import express from "express";
import { json, urlencoded } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
const app = express();

//
//REQUEST RESOLUTION PATH
//

//Configuration middleware
const ACCEPTED_ORIGIN = "localhost:3000" //IP of static files server for production
const corsOptions = {
  origin: `http://${ACCEPTED_ORIGIN}`,
  credentials: true
};
app.use(cors(corsOptions)); //CORS options specifications
app.use(json()); //Parse requests of content-type application/json so req.body is a JS object parsed from the original JSON
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded
app.use(cookieParser());

//General middleware
app.use(logRequest);
app.use(phonyAuth);
let protectedRoutes = ["/profile", "/add-phone", "/create-trip", "trip/:tripId/*"]; //Does not includ trip/:tripId itself
app.use(protectedRoutes, loggedIn);

//Auth router
import authRouter from "./auth.mjs";
app.use("/auth", authRouter);

//Trip leader route handlers
const tripRouter = express.Router();
tripRouter.use(parseTripId);
tripRouter.get("/", asyncHandler(async (req, res) => {
  res.status(200).json(await getTripData(req.userId, req.tripId));
}));
tripRouter.use("/*", asyncHandler(tripLeaderCheck)); //All other routes require trip leadership
tripRouter.post("/task", asyncHandler(async (req, res) => {
  res.status(200).json(await taskUpdate(req.tripId, req.body));
}));
tripRouter.post("/alter", asyncHandler(async (req, res) => {
  res.status.json(await tripUpdate(req.tripId, req.body))
}));
app.use("/trip/:tripId",tripRouter)

//Specfic route handlers
app.get("/trips", asyncHandler(async (_req, res) => {
  res.status(200).json(await getTrips());
}));
app.get("/profile", asyncHandler(async (req, res) => {
  res.status(200).json(await getUserData(req.userId));
}));
app.post("/add-phone", asyncHandler(async (req, res) => {
  if (!req.body.phoneNum) throw InvalidDataError("Request body lacking phoneNum field");
  await addPhone(req.userId, req.body.phoneNum);
  res.sendStatus(200);
}));
app.post("/create-trip", asyncHandler(async (req, res) => {
  res.status(200).json(await createTrip(req.userId, req.body));
}));

//Default route handler
app.use(asyncHandler(async (_req, res) => {
  throw new NonexistenceError("Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones.");
}));

//Error handlers
app.use(async (err, _req, res, _next) => {
  if (err instanceof Sequelize.BaseError) {
    res.status(422).json({ errMessage: "SQL operation failure. Possible sources: broken unique constraint, data too long, or data of wrong type" })
  } else if (err instanceof AuthError) {
    res.status(401).json({ errMesssage: `${err}` })
  } else if (err instanceof NonexistenceError) {
    res.status(404).json({ errMessage: `${err}` })
  } else if (err instanceof InvalidDataError) {
    res.status(422).json({ errMessage: `${err}`});
  } else {
    logger.log(`INTERNAL ERROR: ${err}`);
    res.status(500).json({ errMessage: `Internal Server Error: ${err}`})
  }
});


// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
