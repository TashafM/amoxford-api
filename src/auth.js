const jwt = require("jsonwebtoken");
const { query } = require("./db");

// Express 4 does not catch errors from async handlers; this sends them to the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Requires a valid "Authorization: Bearer <token>" for an admin user.
const requireAdmin = h(async (req, res, next) => {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication token missing" });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.SECRET_KEY);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
  const { rows } = await query("SELECT id, email, role FROM users WHERE id = $1", [decoded.userId]);
  if (!rows[0]) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
  if (rows[0].role !== "admin") {
    return res.status(403).json({ success: false, message: "Unauthorized access to do this operation" });
  }
  req.user = rows[0];
  next();
});

module.exports = { h, requireAdmin };
