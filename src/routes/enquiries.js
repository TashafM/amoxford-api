const router = require("express").Router();
const { query, newId, shape } = require("../db");
const { h, requireAdmin } = require("../auth");
const { validateEnquiry, isRateLimited } = require("../guard");

// Public contact form on the website.
router.post("/api/v1/send-query", h(async (req, res) => {
  // Honeypot: hidden "website" field. Bots fill it; pretend success so they don't adapt.
  if (req.body?.website) {
    return res.json({ success: true, message: "Message sent successfully!" });
  }
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ success: false, message: "Too many messages. Please try again after some time." });
  }
  const { data, error } = validateEnquiry(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  await query(
    "INSERT INTO enquiries (id, name, phone_number, message) VALUES ($1, $2, $3, $4)",
    [newId(), data.name, data.phone_number, data.message]
  );
  res.json({ success: true, message: "Message sent successfully!" });
}));

// ?page=1&limit=10&q=<search name, phone or message>
router.get("/api/v1/get-queries", requireAdmin, h(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const q = String(req.query.q || "").trim().slice(0, 100);

  // Escape LIKE wildcards so the search text matches literally (backslash is the default LIKE escape).
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const where = q
    ? "WHERE name ILIKE $1 OR phone_number ILIKE $1 OR message ILIKE $1"
    : "";
  const params = q ? [pattern] : [];

  const [list, count] = await Promise.all([
    query(
      `SELECT * FROM enquiries ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params
    ),
    query(`SELECT count(*)::int AS n FROM enquiries ${where}`, params),
  ]);
  const total = count.rows[0].n;
  res.json({
    success: true,
    data: list.rows.map(shape.enquiry),
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit,
    },
    message: "Enquiries fetched successfully!",
  });
}));

router.delete("/api/v1/delete-query/:id", requireAdmin, h(async (req, res) => {
  const { rowCount } = await query("DELETE FROM enquiries WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ success: false, message: "Form entry not found." });
  res.json({ success: true, message: "Form entry deleted successfully." });
}));

module.exports = router;
