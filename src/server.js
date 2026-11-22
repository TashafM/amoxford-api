require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { pool } = require("./db");

const app = express();

// nginx on the same machine proxies requests: trust its X-Forwarded-For so req.ip
// is the visitor's IP (needed for the per-IP rate limits).
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  credentials: true,
}));

app.get("/", (req, res) => res.send("Server up and running"));

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
    return res.status(413).json({ success: false, message: "Image is larger than 12 MB" });
  }
  res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
});

const port = process.env.PORT || 8081;
pool.query("SELECT 1")
  .then(() => {
    app.listen(port, () => console.log(`API on port ${port}, database connected`));
  })
  .catch((err) => {
    console.error("Cannot connect to PostgreSQL:", err.message);
    process.exit(1);
  });
