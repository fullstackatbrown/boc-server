/*
require("dotenv").config();
const session = require("express-session");
*/

//Set up pool for database connection
import { createPool } from "mariadb";
const pool = createPool({
  host: "localhost",
  user: "service",
  database: "boc",
  password: "test123",
  connectionLimit: 5,
});
// }}}

//Logger
const fs = require("fs").promises;
const LOG_FILE = "log.txt";
const logger = {
  log_file: LOG_FILE,
  async log(msg) {
    fs.appendFile(this.log_file, msg);
  }
}

//Handle global errors without shutting the whole program down
process.on("unhandledRejection", (reason, promise) => {
  err_msg = `FAILED PROMISE: ${promise} failed because ${reason}`;
  console.error(err_msg);
  logger.log(err_msg);
});
process.on("uncaughtException", (reason, exception_origin) => {
  err_msg = `EXCEPTION THROWN: ${exception_origin} failed because ${reason}`;
  console.error(err_msg);
  logger.log(err_msg);
})

//Exmaple of querying database
async function getUserInfo(email) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT * FROM users u WHERE u.email == ${email}`,
    );
    return rows;
  } catch (err) {
    throw err;
  } finally {
    if (conn) conn.end();
  }
}

//
//QUERY HELPERS
//

async function getTrips() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT * FROM trips");
    return rows;
  } catch (err) {
    throw err;
  } finally {
    if (conn) conn.end();
  }
}


//Express app setup
import express, { json, urlencoded } from "express";
import cors from "cors";
const app = express();

//
//REQUEST RESOLUTION PATH
//
/*
const ACCEPTED_ORIGIN = //[IP of static files server]
const corsOptions = {
  origin: `http://${ACCEPTED_ORIGIN}`,
};
app.use(cors(corsOptions)); //CORS options specifications
*/
app.use(json()); //Parse requests of content-type - application/json
app.use(urlencoded({ extended: true })); //*huh* : Parse requests of content-type - application/x-www-form-urlencoded

app.get("/", async (req, res) => { //Root route
  logger.log("RECEIVED CONNECT");
  let trips = await getTrips();
  console.log(trips);
  //res.json({ message: "Welcome to the BOC server." });
  res.json(trips);
});

app.get("/trips", async (req, res) => {
  res.json(await getTrips());
});

app.get("/home", async (req, res) => {
  res.json(await getUserInfo("william_l_stone@brown.edu"));
});

// set port, listen for requests
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  fs.rm(LOG_FILE); //Refreshes log on startup
  logger.log(`STARTUP: Running on port ${PORT}.`);
});
