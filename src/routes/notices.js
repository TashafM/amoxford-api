const router = require("express").Router();
const { query, newId, shape } = require("../db");
const { h, requireAdmin } = require("../auth");

// Body: { date: <ms timestamp>, notice: <text> }
function validNotice(body = {}) {
  const text = typeof body.notice === "string" ? body.notice.trim() : "";
  const date = Number(body.date);
  if (!Number.isFinite(date) || !text || text.length > 1000) return null;
  return { date: String(date), notice: text };
}
const invalid = (res) =>
  res.status(400).json({ success: false, message: "Please enter a valid date and notice (max 1000 characters)." });

router.get("/api/v1/get-notices", h(async (req, res) => {
  const { rows } = await query("SELECT * FROM notices ORDER BY created_at DESC");
  res.json({ success: true, notices: rows.map(shape.notice) });
}));

router.post("/api/v1/add-notice", requireAdmin, h(async (req, res) => {
  const data = validNotice(req.body);
  if (!data) return invalid(res);
  await query("INSERT INTO notices (id, date, notice) VALUES ($1, $2, $3)", [newId(), data.date, data.notice]);
  res.status(201).json({ success: true, result: "Notice added successfully" });
}));

router.put("/api/v1/update-notice/:id", requireAdmin, h(async (req, res) => {
  const data = validNotice(req.body);
  if (!data) return invalid(res);
  const { rows } = await query(
    "UPDATE notices SET date = $1, notice = $2, updated_at = now() WHERE id = $3 RETURNING *",
    [data.date, data.notice, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: "Notice not found" });
  res.json({ success: true, notice: shape.notice(rows[0]) });
}));

router.delete("/api/v1/delete/:id", requireAdmin, h(async (req, res) => {
  await query("DELETE FROM notices WHERE id = $1", [req.params.id]);
  res.json({ success: true, result: "Deleted successfully" });
}));

module.exports = router;
