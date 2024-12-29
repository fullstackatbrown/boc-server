const mariadb = require("mariadb");
const pool = mariadb.createPool({
  host: "localhost",
  user: "service",
  password: "test123",
  database: "boc",
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
asyncFunction().then(() => {
  pool.end();
});

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
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the BOC server." });
});

// set port, listen for requests
const PORT = process.env.PORT || 8079;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
