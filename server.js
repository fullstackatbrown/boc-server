const mariadb = require("mariadb");
const pool = mariadb.createPool({
  host: "localhost",
  user: "service",
  database: "boc",
  password: "test123",
  connectionLimit: 5,
});

async function asyncFunction() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT 1 as val");
    console.log(rows);
  } catch (err) {
    throw err;
  } finally {
    if (conn) conn.end();
  }
}
asyncFunction()

// Examples of queries:
/*
const res = await conn.query("INSERT INTO myTable value (?, ?)", [
  1,
  "mariadb",
  ]);
  console.log(res); // { affectedRows: 1, insertId: 1, warningStatus: 0 }
  const trips = await conn.query("SELECT * FROM trips");
  console.log(trips);
*/

async function getTrips() {
  let conn = await pool.getConnection();
  const trips = await conn.query("SELECT * FROM trips");
  conn.end();
  return trips;
}

// async function 

const express = require("express");
const cors = require("cors");
const app = express();

var corsOptions = {
  origin: "http://localhost:8081",
};

app.use(cors(corsOptions));

// parse requests of content-type - application/json
app.use(express.json());

// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// simple route
app.get("/", async (req, res) => {
  console.log("RECEIVED CONNECT");
  let trips = await getTrips();
  console.log(trips);
  //res.json({ message: "Welcome to the BOC server." });
  res.json(trips);
});

// set port, listen for requests
const PORT = process.env.PORT || 8079;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
