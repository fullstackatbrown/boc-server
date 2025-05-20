import logger from "./logger.mjs";
import models from "./models.mjs";
const { User, Trip, TripSignUp, TripClass } = models;
import errors from "./errors.mjs";
const {
  AuthError,
  NonexistenceError,
  InvalidDataError,
  IllegalOperationError,
} = errors;
import { Sequelize } from "sequelize";
import queries from "./queries.mjs";
const {
  getTrips,
  getLeaders,
  getUserData,
  getTripData,
  createUser,
  addPhone,
  createTrip,
  taskUpdate,
  tripUpdate,
  openTrip,
  runLottery,
  doAttendance,
  tripSignup,
  isSignedUp,
} = queries;

import axios from "axios";

//
//MIDDLEWARE
//

//Logs method and origin of incoming requests
async function logRequest(req, _res, next) {
  logger.log(
    `${req.method} request for ${req.path} received from ${req.connection.remoteAddress}:${req.connection.remotePort}`,
  );
  next();
}

//Checks authentication of incoming requests
async function authenticate(req, res, next) {
  const token = req.headers.token;

  //if (!token) {
  //  //No auth token yet - front end should treat this as a sign, so start google auth process
  //  logger.log(
  //    `Authentication failed for ${req.connection.remoteAddress}:${req.connection.remotePort}`,
  //  );
  //  return res.status(401).json({ error: "Unauthorized: No token provided" });
  //}

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

    let user = await User.findOne({
      where: {
        email: response.data.email,
      },
    });

    if (user == null) {
      console.log("CREATING ACCOUNT");
      user = createUser(
        response.data.given_name,
        response.data.family_name ? response.data.family_name : "",
        response.data.email,
      );
    }

    //If no error occurs, we attach the user's id and continue
    req.userId = user.id;
    next();
  } catch (error) {
    // Continue as if the user is not authenticated
    next();
  }
}

//Replacement authentication for testing; Change TESTID to take actions on differing accounts
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
      tripId: req.tripId,
    },
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
      tripId: tripId,
    },
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

//
//REQUEST RESOLUTION PATH
//

//Configuration middleware
const ACCEPTED_ORIGIN = "localhost:3000"; //IP of static files server for production
const corsOptions = {
  origin: `http://${ACCEPTED_ORIGIN}`,
  credentials: true,
};
app.use(cors(corsOptions)); //CORS options specifications
app.use(invalidRecast(json())); //Parse requests of content-type application/json so req.body is a JS object parsed from the original JSON
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded
app.use(cookieParser());

//General middleware
app.use(logRequest);

//Auth router
import authRouter from "./auth.mjs";
app.use("/auth", authRouter);

app.use(authenticate);
let protectedRoutes = [
  "/profile",
  "/add-phone",
  "/create-trip",
  "/signup",
  "trip/:tripId/*",
]; //Does not includ trip/:tripId itself
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
  }),
);
tripRouter.get(
  "/is-signed-up",
  asyncHandler(async (req, res) => {
    res.status(200).json(await isSignedUp(req.userId, req.tripId));
  }),
);
tripRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    await tripSignup(req.userId, req.tripId);
    res.sendStatus(200);
  }),
);
tripRouter.post(
  "/lead/task",
  asyncHandler(async (req, res) => {
    await taskUpdate(req.Trip, req.body);
    res.sendStatus(200);
  }),
);
tripRouter.post(
  "/lead/alter",
  asyncHandler(async (req, res) => {
    await tripUpdate(req.Trip, req.body);
    res.sendStatus(200);
  }),
);
tripRouter.post(
  "/lead/open",
  asyncHandler(async (req, res) => {
    await openTrip(req.Trip);
    res.sendStatus(200);
  }),
);
tripRouter.post(
  "/lead/lottery",
  asyncHandler(async (req, res) => {
    res.status(200).json(await runLottery(req.Trip));
  }),
);
tripRouter.post(
  "/lead/attendance",
  asyncHandler(async (req, res) => {
    await doAttendance(req.Trip, req.body);
    res.sendStatus(200);
  }),
);
/*
tripRouter.post("/participate/confirm", asyncHandler(async (req, res) => {
  await tripSignup(req.User, )
}))*/

app.use("/trip/:tripId", tripRouter);

//User action route handlers
const userRouter = express.Router();
userRouter.use(loggedIn);
userRouter.use(asyncHandler(grabUser));

userRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    res.status(200).json(await getUserData(req.User));
  }),
);
userRouter.post(
  "/add-phone",
  asyncHandler(async (req, res) => {
    if (!req.body.hasOwnProperty("phoneNum"))
      throw new InvalidDataError("Request body lacking phoneNum field");
    await addPhone(req.User, req.body.phoneNum);
    res.sendStatus(200);
  }),
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
  }),
);

app.use("/leader", leaderRouter);

//General route handlers
app.get(
  "/trips",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getTrips());
  }),
);
app.get(
  "/leaders",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await getLeaders());
  }),
);

//Default route handler
app.use(
  asyncHandler(async (_req, res) => {
    throw new NonexistenceError(
      "Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones.",
    );
  }),
);

//Error handlers
app.use(async (err, _req, res, _next) => {
  if (err instanceof Sequelize.BaseError) {
    //logger.log(err.message);
    res.status(422).json({
      errMessage:
        "SQL operation failure. Possible sources: broken unique constraint, data too long, or data of wrong type",
    });
  } else if (err instanceof AuthError) {
    res.status(401).json({ errMesssage: `${err}` });
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

// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
