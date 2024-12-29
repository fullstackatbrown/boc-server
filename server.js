require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const mariadb = require("mariadb");

const app = express();

var corsOptions = {
  origin: "http://localhost:3000",
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MariaDB {{{
const pool = mariadb.createPool({
  host: "localhost",
  user: "service",
  database: "boc",
  password: "test123",
  connectionLimit: 5,
});
// }}}

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

// simple route
app.get("/", async (req, res) => {
  console.log("RECEIVED CONNECT");
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
  console.log(`Server is running on port ${PORT}.`);
});
