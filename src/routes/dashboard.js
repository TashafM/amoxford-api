const router = require("express").Router();
const { query, shape } = require("../db");
const { h, requireAdmin } = require("../auth");

// `section` column -> admin panel route segment, so recent uploads link to their event page.
const SECTION_PATH = {
  events: "important-events",
  "extra-curricular": "extra-curricular-activities",
  "pre-primary": "pre-primary-activities",
};

router.get("/get-dashboard", requireAdmin, h(async (req, res) => {
  const [counts, recentEnquiries, latestNotices, recentImages] = await Promise.all([
    query(`SELECT
      (SELECT count(*)::int FROM notices) AS notices,
      (SELECT count(*)::int FROM enquiries) AS enquiries,
      (SELECT count(*)::int FROM images) AS gallery,
      (SELECT count(*)::int FROM enquiries WHERE created_at >= now() - interval '7 days') AS "enquiriesThisWeek"`),
    query("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 5"),
    query("SELECT * FROM notices ORDER BY created_at DESC LIMIT 3"),
    query(`SELECT i.*, c.section, c.name AS category_name
      FROM images i
      LEFT JOIN (SELECT DISTINCT ON (slug) slug, section, name FROM categories ORDER BY slug, id) c
        ON c.slug = i.category
      ORDER BY i."timestamp" DESC, i.id DESC LIMIT 8`),
  ]);

  res.json({
    success: true,
    data: {
      ...counts.rows[0],
      recentEnquiries: recentEnquiries.rows.map(shape.enquiry),
      latestNotices: latestNotices.rows.map(shape.notice),
      recentImages: recentImages.rows.map((r) => ({
        ...shape.image(r),
        section: SECTION_PATH[r.section],
        categoryName: r.category_name ?? undefined,
      })),
    },
  });
}));

module.exports = router;
