const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { query } = require("../db");
const { h } = require("../auth");
const { isRateLimited, clientIp } = require("../rateLimit");
const { resetPasswordEmail } = require("../emails/resetPassword");

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
    const email = resetPasswordEmail({
      name: user.firstname,
      resetUrl: `${process.env.ADMIN_URL}/reset-password/${user.id}/${token}`,
      expiresInMinutes: 60,
    });
    await mailer.sendMail({
      from: { name: "A.M. OXFORD Admin", address: process.env.MAIL_USER },
      to: user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (error) {
    console.error("Reset email failed:", error);
    return res.status(500).json({ success: false, message: "Could not send reset email" });
  }
  sent();
}));

// The user a reset link belongs to, or null if the link is wrong, expired, or already used
// (using it changes the password hash, which is part of the signing secret).
async function userForResetLink(id, token) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  const user = rows[0];
  if (!user) return null;
  try {
    const decoded = jwt.verify(token, resetSecret(user));
    return String(decoded.id) === user.id ? user : null;
  } catch {
    return null;
  }
}
const invalidLink = (res) => res.status(400).json({ success: false, message: "Invalid or expired link" });

// Lets the reset page show "link expired" as soon as it opens, before the form is filled in.
router.get("/reset-password/:id/:token", h(async (req, res) => {
  if (!(await userForResetLink(req.params.id, req.params.token))) return invalidLink(res);
  res.json({ success: true, valid: true });
}));

router.post("/reset-password/:id/:token", h(async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }
  const user = await userForResetLink(req.params.id, req.params.token);
  if (!user) return invalidLink(res);
  await query("UPDATE users SET password = $1, updated_at = now() WHERE id = $2", [
    await bcrypt.hash(password, 10),
    user.id,
  ]);
  res.json({ success: true, message: "Password changed successfully!" });
}));

module.exports = router;
