const router = require("express").Router();
const multer = require("multer");
const { query, newId, shape } = require("../db");
const { h, requireAdmin } = require("../auth");
const storage = require("../storage");

// Same 12 MB cap as nginx (client_max_body_size 12M).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

// file_<timestamp>_<8 random digits>_<original name>.webp (same format as the old server).
const makeFilename = (baseName) =>
  `file_${Date.now()}_${Math.floor(10000000 + Math.random() * 90000000)}_${baseName}.webp`;

// Old image URLs (/Images/<file>, /Images/thumbs/<file>) now live on R2.
router.get("/Images/*", (req, res) => res.redirect(301, storage.publicUrl(req.params[0])));

router.post("/upload", requireAdmin, upload.array("files"), h(async (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).send("Category is required.");
  if (!req.files?.length) return res.status(400).send("No images received.");

  const filenames = [];
  for (const file of req.files) {
    const filename = makeFilename(file.originalname.replace(/\.[^/.]+$/, ""));
    await storage.saveImage(filename, await storage.processImage(file.buffer));
    await query("INSERT INTO images (id, filename, category) VALUES ($1, $2, $3)", [newId(), filename, category]);
    filenames.push(filename);
  }
  res.json({ message: "Images uploaded and processed successfully", filenames });
}));

// Public gallery list. Body: { category?, page?, limit? }
router.post("/get-images", h(async (req, res) => {
  const page = Math.max(parseInt(req.body?.page) || 1, 1);
  const limit = Math.min(parseInt(req.body?.limit) || 10, 50);
  const category = req.body?.category;
  const where = category ? "WHERE category = $1" : "";
  const params = category ? [category] : [];

  const [list, count] = await Promise.all([
    query(
      `SELECT * FROM images ${where} ORDER BY "timestamp" DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params
    ),
    query(`SELECT count(*)::int AS n FROM images ${where}`, params),
  ]);
  const total = count.rows[0].n;
  res.json({
    images: list.rows.map(shape.image),
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    totalImages: total,
  });
}));

router.delete("/delete-image/:id", requireAdmin, h(async (req, res) => {
  const { rows } = await query("DELETE FROM images WHERE id = $1 RETURNING filename", [req.params.id]);
  if (!rows[0]) return res.status(404).send({ success: false, message: "Image not found" });
  await storage.deleteImage(rows[0].filename);
  res.json({ success: true, message: "Image deleted successfully" });
}));

// Body: { angle: 90 | 180 | 270 } clockwise. Saves under a NEW filename because images are
// cached as immutable for a year: overwriting would keep showing the old orientation.
router.patch("/rotate-image/:id", requireAdmin, h(async (req, res) => {
  const angle = Number(req.body?.angle);
  if (![90, 180, 270].includes(angle)) {
    return res.status(400).send({ success: false, message: "angle must be 90, 180 or 270" });
  }
  const { rows } = await query("SELECT * FROM images WHERE id = $1", [req.params.id]);
  const image = rows[0];
  if (!image) return res.status(404).send({ success: false, message: "Image not found" });

  const original = await storage.get(image.filename);
  const filename = makeFilename(image.filename.replace(/^file_\d+_(\d{8}_)?/, "").replace(/\.webp$/, ""));
  await storage.saveImage(filename, await storage.processImage(original, angle));

  const updated = await query("UPDATE images SET filename = $1 WHERE id = $2 RETURNING *", [filename, image.id]);
  await storage.deleteImage(image.filename);
  res.json({ success: true, image: shape.image(updated.rows[0]) });
}));

module.exports = router;
