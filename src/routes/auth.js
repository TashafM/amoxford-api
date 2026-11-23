const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { query } = require("../db");
const { h } = require("../auth");
const { isRateLimited, clientIp } = require("../rateLimit");

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
});

// Reset links are signed with RESET_SECRET + the password hash: they stop working once used.
const resetSecret = (user) => process.env.RESET_SECRET + user.password;

// Admin panel login. Only role "admin"; a `role` sent by the client is ignored.
router.post("/api/v1/login", h(async (req, res) => {
  if (await isRateLimited(`login:${clientIp(req)}`)) {
    return res.status(429).json({
      success: false, message: "Too many login attempts. Please try again in 10 minutes.",
    });
  }
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }
  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email.trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  }
  if (user.role !== "admin") {
    return res.status(403).json({ success: false, message: "This account does not have admin access" });
  }
  const accessToken = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.SECRET_KEY,
    { expiresIn: "12h" }
  );
  res.json({ success: true, message: `Welcome back ${user.firstname}`, accessToken });
}));

router.post("/api/v1/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true });
  res.json({ success: true, message: "Logged out successfully" });
});

router.post("/forgot-password", h(async (req, res) => {
  // Same reply whether or not the email exists, so nobody can probe for admin emails.
  const sent = () => res.json({
    success: true,
    message: "If this email is registered, a reset link has been sent. Check your inbox.",
  });
  if (await isRateLimited(`forgot:${clientIp(req)}`)) {
    return res.status(429).json({ success: false, message: "Too many requests. Please try again in 10 minutes." });
  }
  const { email } = req.body || {};
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ success: false, message: "Please enter your email" });
  }
  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email.trim()]);
  const user = rows[0];
  if (!user || user.role !== "admin") return sent();

  const token = jwt.sign({ id: user.id }, resetSecret(user), { expiresIn: "1h" });
  try {
    await mailer.sendMail({
      from: process.env.MAIL_USER,
      to: user.email,
      subject: "Reset your password - A.M. OXFORD Admin",
      text: `${process.env.ADMIN_URL}/reset-password/${user.id}/${token}`,
    });
  } catch (error) {
    console.error("Reset email failed:", error);
    return res.status(500).json({ success: false, message: "Could not send reset email" });
  }
  sent();
}));

router.post("/reset-password/:id/:token", h(async (req, res) => {
  const invalid = () => res.status(400).json({ success: false, message: "Invalid or expired link" });
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  const user = rows[0];
  if (!user) return invalid();
  try {
    // Throws if signature is wrong, token expired, or the password already changed.
    const decoded = jwt.verify(req.params.token, resetSecret(user));
    if (String(decoded.id) !== user.id) return invalid();
  } catch {
    return invalid();
  }
  await query("UPDATE users SET password = $1, updated_at = now() WHERE id = $2", [
    await bcrypt.hash(password, 10),
    user.id,
  ]);
  res.json({ success: true, message: "Password changed successfully!" });
}));

module.exports = router;
