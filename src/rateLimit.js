// Per-key rate limit stored in PostgreSQL, so it works across Vercel's serverless
// instances (each request may run in a fresh process with empty memory).
const { query } = require("./db");

// Fixed window: at most `max` hits per `windowMinutes` for one key.
// One atomic statement: a new window starts when the old one has expired.
async function isRateLimited(key, max = 5, windowMinutes = 10) {
  const { rows } = await query(
    `INSERT INTO rate_limits (key, hits, window_start) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.window_start < now() - make_interval(mins => $2)
                   THEN 1 ELSE rate_limits.hits + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(mins => $2)
                           THEN now() ELSE rate_limits.window_start END
     RETURNING hits`,
    [key, windowMinutes]
  );
  return rows[0].hits > max;
}

// Remove windows older than a day (called by the daily cron).
const cleanupRateLimits = () => query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");

// Visitor IP. Vercel overwrites x-real-ip with the real client address, so it cannot be
// faked; elsewhere (local dev, behind nginx) Express's req.ip is used.
const clientIp = (req) => (process.env.VERCEL && req.headers["x-real-ip"]) || req.ip;

module.exports = { isRateLimited, cleanupRateLimits, clientIp };
