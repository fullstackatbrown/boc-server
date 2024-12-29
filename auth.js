const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const { OAuth2Client } = require("google-auth-library");
require("dotenv").config();

const app = express();
var corsOptions = {
  origin: "http://localhost:3000",
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(bodyParser.json());

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post("/auth/google", async (req, res) => {
  const { code } = req.body;

  try {
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const tokens = response.data;
    console.log("Tokens:", tokens);

    // You can save tokens in the database and send relevant info back to the
    // frontend
    res.status(200).json({ message: "Login successful", tokens });
  } catch (error) {
    console.error(
      "Error exchanging code:",
      error.response?.data || error.message,
    );
    res.status(500).json({ error: "Failed to exchange authorization code" });
  }
});

const PORT = 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
