const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const axios = require("axios");
const { OAuth2Client } = require("google-auth-library");

const corsOptions = {
  origin: "http://localhost:3000",
  credentials: true,
};
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(cors(corsOptions));
app.use(cookieParser());

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

    const token = response.data.access_token;

    res.cookie("access_token", token, {
      httpOnly: true, // Prevents JavaScript access
      secure: process.env.NODE_ENV === "production", // HTTPS only in production
      sameSite: "strict", // Mitigates CSRF attacks
      maxAge: 3600 * 1000, // 1 hour
    });

    res.status(200).json({ message: "Login successful" });
  } catch (error) {
    console.error(
      "Error exchanging code:",
      error.response?.data || error.message,
    );
    res.status(500).json({ error: "Failed to exchange authorization code" });
  }
});

app.get("/protected", async (req, res) => {
  const token = req.cookies.access_token;

  if (!token) {
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

    res.json(response.data);
  } catch (error) {
    console.error("Failed to fetch protected data:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

const PORT = 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
