const router = require("express").Router();
const { query, newId, shape } = require("../db");
const { h, requireAdmin } = require("../auth");

// URL segment -> `section` column. The old server had one collection per section.
const SECTIONS = {
  events: "events",
  "extra-curricular": "extra-curricular",
  "pre-primary": "pre-primary",
};

for (const [segment, section] of Object.entries(SECTIONS)) {
  const base = `/api/${segment}/categories`;

  // ORDER BY id = creation order (ids start with a timestamp), same order MongoDB returned.
  router.get(base, h(async (req, res) => {
    const { rows } = await query("SELECT * FROM categories WHERE section = $1 ORDER BY id", [section]);
    res.json(rows.map(shape.category));
  }));

  // Body: { name, slug, bannerImage? }
  router.post(base, requireAdmin, h(async (req, res) => {
    const { name, slug, bannerImage } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof slug !== "string" || !slug.trim()) {
      return res.status(400).json({ message: "name and slug are required" });
    }
    const { rows } = await query(
      "INSERT INTO categories (id, section, name, slug, banner_image) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [newId(), section, name.trim(), slug.trim(), typeof bannerImage === "string" && bannerImage ? bannerImage : "#"]
    );
    res.status(201).json(shape.category(rows[0]));
  }));

  // Updates only the banner image (same as the old server).
  router.put(`${base}/:id`, requireAdmin, h(async (req, res) => {
    const { bannerImage } = req.body || {};
    if (typeof bannerImage !== "string" || !bannerImage) {
      return res.status(400).json({ message: "bannerImage is required" });
    }
    const { rows } = await query(
      "UPDATE categories SET banner_image = $1 WHERE id = $2 AND section = $3 RETURNING *",
      [bannerImage, req.params.id, section]
    );
    if (!rows[0]) return res.status(404).json({ message: "Category not found" });
    res.json(shape.category(rows[0]));
  }));

  router.delete(`${base}/:id`, requireAdmin, h(async (req, res) => {
    const { rowCount } = await query("DELETE FROM categories WHERE id = $1 AND section = $2", [req.params.id, section]);
    if (!rowCount) return res.status(404).json({ message: "Category not found" });
    res.json({ message: "Category deleted successfully" });
  }));
}

module.exports = router;
