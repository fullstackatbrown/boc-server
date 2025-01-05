import logger from "./logger.mjs";

//Handle global errors without shutting the whole program down
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

//
//QUERY HELPERS
//

import models from './models.mjs';
const { User, Trip, TripSignUp, TripClass } = models;

function getTrips() {
  let pubTrips = Trip.findAll({
    attributes: { exclude: ['id', 'planningChecklist'] },
    where: { public: true }
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
  if (!trip) { throw new Error("Request trip does not exist") }
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
    if (!trip.public) { throw new Error("Trip is currently private") }
    delete trip.planningChecklist;
    userData = null;
  } else if (signup.tripRole == 'Leader') { //User is a Leader
    userData = signup.toJSON();
  } else { //User is a Participant
    if (!trip.public) { throw new Error("Trip is currently private") }
    delete trip.planningChecklist;
    userData = signup.toJSON();
  }
  trip.userData = userData;
  return trip;
}

//
//MIDDLEWARE
//

//Logs method and origin of incoming requests
async function logRequest(req, _res, next) {
  logger.log(`${req.method} request received from ${req.connection.remoteAddress}:${req.connection.remotePort}`);
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
app.use(json()); //Parse requests of content-type - application/json
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded
app.use(cookieParser());

//General middleware
app.use(logRequest);
const protected_routes = ["/home"]; //Includes all subroutes
app.use(protected_routes, authenticate);

//Auth router
import authRouter from "./auth.mjs";
app.use("/auth", authRouter);

//Specific route handlers
app.get("/trips", async (_req, res) => {
  res.json(await getTrips());
});
app.get("/profile", async (req, res) => {
  res.json(await getUserData(req.userId));
});
//Assuming tripId is of the form "tripName-id"
app.get("/trip/:tripId", async (req, res) => {
  let tripId = parseInt(req.params.tripId.split('-')[1]);
  if (Number.isNaN(tripId)) { return res.json({ errMessage: "Url malformed, likely due to user tampering"}); }
  try { res.json(await getTripData(req.userId, tripId)); }
  catch (error) { res.json({ errMessage: "Trip page requested doesn't exist or is private"}); }
});

//Default route handler
app.use(async (_req, res) => {
  res.json({ message: "Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones." });
})

// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
