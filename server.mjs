import "dotenv/config";
import logger from "./logger.mjs";
import models from "./models.mjs";
const { User, Trip, TripSignUp } = models;
import errors from "./errors.mjs";
const {
  AuthError,
  NonexistenceError,
  InvalidDataError,
  IllegalOperationError
} = errors;
import { Sequelize } from "sequelize";
import queries from "./queries.mjs";
const {
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
  taskUpdate,
  tripUpdate,
  openTrip,
  addParticipant,
  removeParticipant,
  runLottery,
  cancelTrip,
  doAttendance,
  tripSignup,
  isSignedUp,
  confirmSignup,
  cancelSignup,
  listervAdd
} = queries;
import cron from "node-cron";
import jobs from "./server_jobs.mjs";
//Trip notification emails. These never throw - see email-client/mailer.mjs.
import {
  notifyLottery,
  notifyWaitlistPromotion,
  notifyAttendance,
  notifyTripCancellation
} from "./email-client/notifications.mjs";
import { MODE as MAIL_MODE } from "./email-client/mailer.mjs";
//Payment tracking from Brown Marketplace receipts. Never throws - see payments/watcher.mjs.
import { DISABLED as PAYMENT_WATCH_DISABLED, tickPaymentWatcher } from "./payments/watcher.mjs";

import https from "https";
//Bounce watch for the mail above. Never throws - see email-client/bounces.mjs.
import { tickBounceWatcher } from "./email-client/bounces.mjs";
import fs from "fs";

import axios from "axios";

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

//
// FIREBASE CUSTOM TOKENS
//
// The site authenticates with Google through next-auth, not Firebase Auth, so the browser
// carries no Firebase identity and request.auth is null in Firestore/Storage rules. The
// /leader/firebase-token route below mints a token the frontend trades for one, which is
// what lets those rules name a real BOC leader instead of allowing every write.
//
// The service account key is absent on development machines and must never be a hard
// dependency: a missing key disables that one route and nothing else.
const FIREBASE_KEY_PATH = process.env.FIREBASE_KEY_PATH || "./firebase-auth.json";
let firebaseAuth = null;
let firebaseKeyProblem = null;
try {
  const key = JSON.parse(fs.readFileSync(FIREBASE_KEY_PATH, "utf8"));
  firebaseAuth = getAuth(initializeApp({ credential: cert(key) }));
} catch (err) {
  //Deliberately does not log err: a JSON.parse failure can quote the offending text, and
  //that text is a private key. The path and whether it was there is all an operator needs.
  firebaseKeyProblem = err.code === "ENOENT" ? "not found" : "unreadable or malformed";
}

//
//MIDDLEWARE
//

//Logs method and origin of incoming requests
async function logRequest(req, _res, next) {
  //req.ip is the X-Forwarded-For client behind nginx, and the socket address otherwise
  logger.log(`${req.method} request for ${req.path} received from ${req.ip}`);
  next();
}

//
// TEST IDENTITY BYPASS
//
// Lets automated tests (verify.py, Playwright) act as any user without a real Google
// login. This is not a convenience: multi-user flows (lottery -> waitlist -> attendance)
// are otherwise untestable, since they need several distinct Brown/RISD accounts acting
// in one run.
//
// A request authenticates as <email> by sending `Authorization: Bearer e2e:<email>`.
// Users are still only auto-created for @brown.edu / @risd.edu addresses, exactly as on
// the real Google path.
//
// SAFETY: this is an impersonation bypass. It is gated on TWO independent conditions and
// is off unless both hold. Never set DEVELOPING in a production environment.
const E2E_TOKEN_PREFIX = "e2e:";
//Compared against "1" rather than passed through Boolean(): env vars are strings, so
//Boolean("0") is true, and a stale DEVELOPING=0 in the production .env read as "on" until
//2026-08-31. Only NODE_ENV=production kept the bypass shut. Set DEVELOPING=1 to enable.
const E2E_AUTH_ENABLED =
  process.env.DEVELOPING === "1" && process.env.NODE_ENV !== "production";

//Returns a Google-userinfo-shaped profile for an e2e token, or null if this isn't one
//(or if the bypass is disabled), in which case the caller falls through to real Google auth
function e2eProfile(token) {
  if (!E2E_AUTH_ENABLED) return null;
  if (!token || !token.startsWith(E2E_TOKEN_PREFIX)) return null;
  const email = token.slice(E2E_TOKEN_PREFIX.length).trim().toLowerCase();
  if (!email.includes("@")) return null;
  //Derive a stable display name from the address: "ada.lovelace@brown.edu" -> Ada Lovelace
  const [localPart] = email.split("@");
  const [first, ...rest] = localPart.split(".");
  return {
    email,
    given_name: first,
    family_name: rest.length > 0 ? rest.join(".") : "E2E"
  };
}

//Checks authentication of incoming requests
async function authenticate(req, res, next) {
  try {
    // Use the token to fetch data from an external API
    const token = req.headers.authorization?.split(" ")[1];

    // If the token is not a valid google token (or was not supplied), this axios request will fail.
    // A test-identity token short-circuits the Google call with an equivalent profile.
    const profile =
      e2eProfile(token) ??
      (
        await axios.get("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
      ).data;

    // If the token is valid but the user hasn't been seen, user will be Null
    let user = await User.findOne({
      where: {
        email: profile.email
      }
    });

    if (user == null) {
      if (profile.email.endsWith("@brown.edu") || profile.email.endsWith("@risd.edu")) {
        user = await createUser(
          profile.given_name,
          profile.family_name ? profile.family_name : "",
          profile.email
        );
        logger.log(`Created new user with email ${profile.email}`);
      } else {
        throw Error("User does not have a Brown or RISD email address.");
      }
    }

    //If no error occurs, we attach the user's id and continue
    req.userId = user.id;
    next();
  } catch (error) {
    // Continue as if the user is not authenticated
    // Reasons we might have gotten here: 
    // - User did not send a token (ie. was looking for content on an unprotected route (standard practice!) OR sent a malformed request to a protected route)
    // - User sent an invalid token (shouldn't happen under usual circumstances)
    // - User sent a valid token that was associated with a non Brown or RISD account (frontend shouldn't let people complete login without a Brown or RISD account, so this shouldn't happen)

    //logger.log("Authentication for user failed: " + error);
    next();
  }
}

//Replacement authentication for testing; Change TESTID to take actions on differing accounts.
//NOTE: prefer the test identity bypass above (an `e2e:<email>` bearer token) - it needs no
//source edit or restart and can switch users mid-run, which this cannot.
const TESTID = 1;
function phonyAuth(req, _res, next) {
  req.userId = TESTID;
  next();
}

//Throws an error if user isn't logged in
function loggedIn(req, _res, next) {
  if (!req.userId) throw new AuthError();
  next();
}

//Sanitizes tripId param and adds it as req.tripId
async function parseTripId(req, _res, next) {
  let tripId = parseInt(req.params.tripId);
  if (Number.isNaN(tripId))
    throw new NonexistenceError("Trip signature improperly formed");
  req.tripId = tripId;
  next();
}

//Assuming req.tripId, adds the Trip object with that ID as req.Trip
async function grabTrip(req, _res, next) {
  const trip = await Trip.findByPk(req.tripId);
  if (!trip)
    throw new NonexistenceError("Trip at specified tripId doesn't exist");
  req.Trip = trip;
  next();
}

//Assuming req.userId and req.tripId, adds the TripSignUp object with those as ids as req.TripSignUp
async function grabSignup(req, _res, next) {
  const signup = await TripSignUp.findOne({
    where: {
      userId: req.userId,
      tripId: req.tripId
    }
  });
  if (!signup)
    throw new NonexistenceError("User not signed up for specified trip");
  if (signup.tripRole !== "Participant")
    throw new NonexistenceError("User not a participant on specified trip");
  req.Signup = signup;
  next();
}

//Assuming req.userId, adds the User object with that id as req.User
async function grabUser(req, _res, next) {
  const user = await User.findByPk(req.userId);
  if (!user) throw new AuthError();
  req.User = user;
  next();
}

//Assuming req.userId and req.tripId, checks that associated user is a leader on the associated trip
async function tripLeaderCheck(req, _res, next) {
  if (!(await isTripLeader(req.userId, req.tripId)))
    throw new AuthError("Must be a trip leader to post to this route");
  next();
}
async function isTripLeader(userId, tripId) {
  //Has benefit of certifying tripId's validity
  const signup = await TripSignUp.findOne({
    where: {
      userId: userId,
      tripId: tripId
    }
  });
  return signup && signup.tripRole == "Leader";
}

//Assuming req.User, checks to make sure the user is a Leader or an Admin
async function leaderPlusCheck(req, _res, next) {
  if (!["Admin", "Leader"].includes(req.User.role))
    throw new AuthError("Must be a leader (or admin) to post to this route");
  next();
}

//Error handling utilities
const asyncHandler = (handler) => {
  //Ugly wrapper to aid with error/rejected promise propogation
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
};
const invalidRecast = (middleware) => {
  return async (req, res, next) => {
    try {
      await middleware(req, res, next);
    } catch (err) {
      next(new InvalidDataError(err.message));
    }
  };
};

//Express app setup
import express from "express";
import { json, urlencoded } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
const app = express();
//Behind nginx every connection arrives from 127.0.0.1, so req.ip would always be loopback.
//Trusting only loopback makes req.ip the real client from X-Forwarded-For while ignoring
//that header from anywhere else - an internet-facing client cannot spoof its own IP.
app.set("trust proxy", "loopback");

//
//REQUEST RESOLUTION PATH
//

//Configuration middleware
const ACCEPTED_ORIGIN = process.env.ACCEPTED_ORIGIN; //IP of static files server for production
const corsOptions = {
  origin: [`${ACCEPTED_ORIGIN}`, "http://localhost:3000"],
  credentials: true
};
app.use(cors(corsOptions)); //CORS options specifications
app.use(invalidRecast(json())); //Parse requests of content-type application/json so req.body is a JS object parsed from the original JSON
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded
app.use(cookieParser());

//General middleware
app.use(logRequest);
app.use(authenticate);
//app.use(phonyAuth);

let protectedRoutes = [
  "/profile",
  "/add-phone",
  "/create-trip",
  "/signup",
  "trip/:tripId/*"
]; //Does not include trip/:tripId itself
app.use(protectedRoutes, loggedIn);

//Trip leader route handlers
const tripRouter = express.Router({ mergeParams: true });
tripRouter.use(asyncHandler(parseTripId));
tripRouter.use("/:subpath", loggedIn); //All routes except "/" itself require user to be logged in
tripRouter.use("/lead", asyncHandler(tripLeaderCheck));
tripRouter.use("/lead", asyncHandler(grabTrip)); //Go ahead and grab trip instance here
tripRouter.use("/participate", asyncHandler(grabSignup));

tripRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getTripData(req.tripId, req.userId));
  })
);
tripRouter.get(
  "/is-signed-up",
  asyncHandler(async (req, res) => {
    res.status(200).json(await isSignedUp(req.userId, req.tripId));
  })
);
tripRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    await tripSignup(req.userId, req.tripId);
    res.sendStatus(200);
  })
);
tripRouter.get(
  "/lead/participants",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getTripParticipants(req.Trip));
  })
);
tripRouter.get(
  "/lead/all-possible-participants",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getPossibleParticipantEmails(req.Trip));
  })
);
tripRouter.post(
  "/lead/task",
  asyncHandler(async (req, res) => {
    await taskUpdate(req.Trip, req.body);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/lead/alter",
  asyncHandler(async (req, res) => {
    await tripUpdate(req.Trip, req.body);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/lead/open",
  asyncHandler(async (req, res) => {
    await openTrip(req.Trip);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/lead/lottery",
  asyncHandler(async (req, res) => {
    const results = await runLottery(req.Trip);
    await notifyLottery(req.Trip, results);
    res.status(200).json(results);
  })
);
tripRouter.post(
  "/lead/add-participant",
  asyncHandler(async (req, res) => {
    const result = await addParticipant(req.Trip, req.body);
    await notifyWaitlistPromotion(req.Trip, result.added);
    res.status(200).json(result);
  })
);
tripRouter.post(
  "/lead/remove-participant",
  asyncHandler(async (req, res) => {
    res.status(200).json(await removeParticipant(req.Trip, req.body));
  })
);
tripRouter.post(
  "/lead/attendance",
  asyncHandler(async (req, res) => {
    const outcome = await doAttendance(req.Trip, req.body);
    await notifyAttendance(req.Trip, outcome);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/lead/cancel",
  asyncHandler(async (req, res) => {
    //req.Trip stays readable in memory after the delete, so the email can still name it
    const outcome = await cancelTrip(req.Trip);
    await notifyTripCancellation(req.Trip, outcome);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/participate/confirm",
  asyncHandler(async (req, res) => {
    await confirmSignup(req.Signup);
    res.sendStatus(200);
  })
);
tripRouter.post(
  "/participate/cancel",
  asyncHandler(async (req, res) => {
    await cancelSignup(req.Signup);
    res.sendStatus(200);
  })
);

app.use("/trip/:tripId", tripRouter);

//User action route handlers
const userRouter = express.Router();
userRouter.use(loggedIn);
userRouter.use(asyncHandler(grabUser));

userRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getBasicUserData(req.User));
  })
);
userRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getUserData(req.User));
  })
);
userRouter.post(
  "/add-phone",
  asyncHandler(async (req, res) => {
    if (!req.body.hasOwnProperty("phoneNum"))
      throw new InvalidDataError("Request body lacking phoneNum field");
    await addPhone(req.User, req.body.phoneNum);
    res.sendStatus(200);
  })
);
userRouter.post(
  "/listserv-add",
  asyncHandler(async (req, res) => {
    await listervAdd(req.User);
    res.sendStatus(200);
  })
);

app.use("/user", userRouter);

//Leader action route handlers
const leaderRouter = express.Router();
leaderRouter.use(loggedIn);
leaderRouter.use(asyncHandler(grabUser));
leaderRouter.use(asyncHandler(leaderPlusCheck));

leaderRouter.post(
  "/create-trip",
  asyncHandler(async (req, res) => {
    res.status(200).json(await createTrip(req.User, req.body));
  })
);

leaderRouter.get(
  "/firebase-token",
  asyncHandler(async (req, res) => {
    if (!firebaseAuth) {
      //503 rather than a thrown error: the caller is authorized and did nothing wrong,
      //the capability just isn't configured here. The frontend can tell it from a 401.
      res.status(503).json({
        errMessage: "Firebase token minting is not configured on this server"
      });
      return;
    }
    //uid is the BOC User id, so Storage rules can scope a path per leader; the email
    //claim is what the Firestore team rule matches against a profile document.
    const token = await firebaseAuth.createCustomToken(String(req.User.id), {
      email: req.User.email
    });
    res.status(200).json({ token });
  })
);

app.use("/leader", leaderRouter);

//General route handlers
app.get(
  "/trips",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getTrips());
  })
);
app.get(
  "/leaders",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getLeaders());
  })
);

//Public (unauthenticated) leader profile routes
const publicRouter = express.Router();

publicRouter.get(
  "/leader-stats/:firstName/:lastName",
  asyncHandler(async (req, res) => {
    const { firstName, lastName } = req.params;
    //Trips led that have actually happened. A Leader signup row exists from the moment a
    //trip is created, so counting them all included Staging/Open/Pre-Trip ones. Post-Trip
    //counts because the trip has run, even if attendance isn't in yet - which is why
    //User.tripsLead can't be used here: doAttendance only increments it at Complete.
    //This is deliberately the same set the profile page's Past Trips table lists.
    const count = await TripSignUp.count({
      where: { tripRole: "Leader" },
      include: [{
        model: User,
        where: { firstName, lastName }
      }, {
        model: Trip,
        where: { status: ["Post-Trip", "Complete"] }
      }]
    });
    res.status(200).json({ totalTrips: count });
  })
);

publicRouter.get(
  "/leader-trips/:firstName/:lastName",
  asyncHandler(async (req, res) => {
    const { firstName, lastName } = req.params;
    const trips = await TripSignUp.findAll({
      where: { tripRole: "Leader" },
      include: [{
        model: User,
        where: { firstName, lastName }
      }, {
        model: Trip
      }]
    });
    const formattedTrips = trips.map(signup => ({
      tripId: signup.Trip.id,
      tripName: signup.Trip.tripName,
      date: signup.Trip.plannedDate,
      sentenceDesc: signup.Trip.sentenceDesc,
      //Additive: the profile page splits Current (Open/Pre-Trip) from Past (Post-Trip/
      //Complete) on this. Every other field stays as-is - the deployed frontend reads them.
      status: signup.Trip.status,
      lotteryInfo: "Hosted Trip"
    }));
    res.status(200).json(formattedTrips);
  })
);

app.use("/public", publicRouter);

//Default route handler
app.use(
  asyncHandler(async (_req, res) => {
    throw new NonexistenceError(
      "Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones."
    );
  })
);

//Error handlers
app.use(async (err, _req, res, _next) => {
  if (err instanceof Sequelize.BaseError) {
    logger.log(err.message);
    res.status(422).json({
      errMessage:
        "SQL operation failure. Possible sources: broken unique constraint, data too long, or data of wrong type"
    });
  } else if (err instanceof AuthError) {
    res.status(401).json({ errMessage: `${err}` });
  } else if (err instanceof NonexistenceError) {
    res.status(404).json({ errMessage: `${err}` });
  } else if (err instanceof InvalidDataError) {
    res.status(422).json({ errMessage: `${err}` });
  } else if (err instanceof IllegalOperationError) {
    res.status(403).json({ errMessage: `${err}` });
  } else {
    let msg;
    if (err instanceof Error) {
      msg = `${err} - stack: ${err.stack}`;
    } else {
      msg = `${err}`;
    }
    logger.log(`INTERNAL ERROR: ${msg}`);
    res.status(500).json({ errMessage: `Internal Server Error: ${err}` });
  }
});

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
});
*/

//Initialize all server jobs
jobs.forEach((job) => cron.schedule(job.cronString, job.job));

//Set port, listen for requests
const PORT = process.env.PORT || 8080; // should be proxied behind nginx

//Deliberately noisy on stderr as well as the log - these must never go unnoticed
function startupWarning(warning) {
  console.warn(`\n!!! ${warning} !!!\n`);
  logger.log(`STARTUP WARNING: ${warning}`);
}

app.listen(PORT, async () => {
  await logger.start();
  logger.log(`STARTUP: Running on port ${PORT}.`);
  if (E2E_AUTH_ENABLED) {
    startupWarning(
      "TEST IDENTITY BYPASS IS ACTIVE - any request may impersonate any user via an " +
      "'e2e:<email>' bearer token. This must NEVER be enabled in production. " +
      "Unset DEVELOPING (or set NODE_ENV=production) to disable.");
  }
  if (!firebaseAuth) {
    startupWarning(
      `Firebase service account key ${firebaseKeyProblem} at ${FIREBASE_KEY_PATH} - ` +
      "/leader/firebase-token will return 503, so leaders cannot sign in to Firebase " +
      "and profile editing fails against any rule requiring request.auth. " +
      "Set FIREBASE_KEY_PATH or place the key at that path.");
  }
  tickBounceWatcher(); //No-op unless MAIL_TRANSPORT=smtp
  if (process.env.NODE_ENV === "production" && MAIL_MODE !== "smtp") {
    //Mail defaults to capture everywhere, so a production box that forgets MAIL_TRANSPORT
    //sends nothing. That must be loud, not silent - it is otherwise invisible until a
    //leader asks why participants never heard about a lottery.
    startupWarning(
      `MAIL_TRANSPORT is "${MAIL_MODE}", not "smtp" - NO EMAIL WILL BE SENT. ` +
      "Set MAIL_TRANSPORT=smtp (plus SMTP_USER and SMTP_PASS) to enable delivery.");
  }
  if (process.env.NODE_ENV === "production" && PAYMENT_WATCH_DISABLED) {
    //Same reasoning as mail: off by default, so forgetting it in production must be loud
    startupWarning(
      `${PAYMENT_WATCH_DISABLED} - NO PAYMENTS WILL BE RECORDED from Marketplace receipts. ` +
      "Set PAYMENT_WATCH=1 and PAYMENT_WATCH_SINCE=<go-live date> to enable.");
  }
  tickPaymentWatcher(); //No-op when disabled
});
