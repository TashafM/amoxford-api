// The Express app. Used by Vercel (api/index.js) and by local dev (src/server.js).
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { query } = require("./db");
const { h } = require("./auth");
const { cleanupRateLimits } = require("./rateLimit");

const app = express();

// Behind a proxy (Vercel, or nginx locally): trust X-Forwarded-For for req.ip.
// On Vercel the client IP comes from x-real-ip instead (see rateLimit.js).
app.set("trust proxy", process.env.VERCEL ? true : "loopback");
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  credentials: true,
}));

app.get("/", (req, res) => res.send("Server up and running"));

// Health check. Also the daily Vercel Cron target: the table read keeps the Supabase
// free-tier project from pausing, and old rate-limit rows are removed.
app.get("/health", h(async (req, res) => {
  const { rows } = await query("SELECT count(*)::int AS notices FROM notices");
  await cleanupRateLimits();
  res.json({ success: true, database: "ok", notices: rows[0].notices });
}));

app.use(require("./routes/auth"));
app.use(require("./routes/notices"));
app.use(require("./routes/enquiries"));
app.use(require("./routes/images"));
app.use(require("./routes/categories"));
app.use(require("./routes/dashboard"));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, message: "Image is larger than 4 MB. Use the direct upload." });
  }
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
});

module.exports = app;
