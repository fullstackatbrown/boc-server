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
//const exec_query = (query_string) => {} 
import models from './models.mjs';
const { User, Trip, TripUserMap, TripClass } = models;

function getTrips() {
  let pubTrips = Trip.findAll({
    attributes: { exclude: ['id', 'planningChecklist'] },
    where: { public: true }
  });
  return pubTrips;
}
/*
async function getUserInfo(email) {
  let conn;
  try {
    let conn = await pool.getConnection();
    const user_data = conn.query(`SELECT * FROM users WHERE email = '${email}'`);
    const user_trips = conn.query(
      `SELECT trip_name FROM (
        trips JOIN (
          SELECT trip_id FROM user_trip_map
          WHERE user_id = (
            SELECT user_id FROM users
            WHERE email = '${email}'
          )
        ) AS trip_ids ON trips.id = trip_ids.trip_id
      )`
    )
    return {
      user_data: await user_data,
      user_trips: await user_trips
    };
  } catch (err) {
    throw err;
  } finally {
    if (conn) conn.release();
  }
}
*/
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
app.get("/me", authRouter);
app.get("/logout", authRouter);
app.post("/auth", authRouter);

//Specific route handlers
app.get("/trips", async (_req, res) => {
  res.json(await getTrips());
});
/*
app.get("/home", async (req, res) => {
  res.json(await getUserInfo("william_l_stone@brown.edu"));
});*/

//Default route handler
app.use(async (_req, res) => {
  res.json({ message: "Welcome to the BOC's data server! You are receiving this message because the route you requested did not match any of our defined ones." });
})

// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
