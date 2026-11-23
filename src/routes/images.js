const router = require("express").Router();
const multer = require("multer");
const { query, newId, shape } = require("../db");
const { h, requireAdmin } = require("../auth");
const storage = require("../storage");

// Classic multipart upload, kept for small files and old clients. Vercel rejects request
// bodies over 4.5 MB, so the admin panel uses the direct upload below instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const RAW_KEY = /^uploads\/[0-9a-f]{24}\/[^/]{1,200}$/;
const baseName = (name) => String(name).replace(/\.[^/.]+$/, "").replace(/[/\\]/g, "_").slice(0, 100) || "image";

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

// Direct upload, step 1: the admin panel asks for one signed link per file.
// Body: { files: [{ name, type, size }] } -> { uploads: [{ key, url }] }
router.post("/upload-url", requireAdmin, h(async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length || files.length > 50) {
    return res.status(400).json({ success: false, message: "Send 1 to 50 files" });
  }
  for (const f of files) {
    if (typeof f?.type !== "string" || !f.type.startsWith("image/")) {
      return res.status(400).json({ success: false, message: `${f?.name || "A file"} is not an image` });
    }
    if (!Number.isInteger(f.size) || f.size < 1 || f.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ success: false, message: `${f.name || "A file"} is larger than 12 MB` });
    }
  }
  const uploads = await Promise.all(files.map(async (f) => {
    const key = `uploads/${newId()}/${baseName(f.name)}`;
    return { key, url: await storage.presignUpload(key, f.type, f.size) };
  }));
  res.json({ success: true, uploads });
}));

// Direct upload, step 2: after the browser PUT the file to R2, resize it, make the
// thumbnail, save the image row and delete the raw upload. One file per call keeps each
// request well inside Vercel's time limit and lets the admin panel show progress.
// Body: { key, category } -> { success, image }
router.post("/upload-complete", requireAdmin, h(async (req, res) => {
  const { key, category } = req.body || {};
  if (typeof category !== "string" || !category.trim()) {
    return res.status(400).json({ success: false, message: "Category is required." });
  }
  if (typeof key !== "string" || !RAW_KEY.test(key)) {
    return res.status(400).json({ success: false, message: "Invalid upload key" });
  }

  let raw;
  try {
    raw = await storage.get(key);
  } catch {
    return res.status(404).json({ success: false, message: "Upload not found. Please upload again." });
  }

  let versions;
  try {
    versions = await storage.processImage(raw);
  } catch {
    await storage.remove([key]);
    return res.status(400).json({ success: false, message: "This file is not a readable image" });
  }

  const filename = makeFilename(key.split("/").pop());
  await storage.saveImage(filename, versions);
  const { rows } = await query(
    "INSERT INTO images (id, filename, category) VALUES ($1, $2, $3) RETURNING *",
    [newId(), filename, category.trim()]
  );
  await storage.remove([key]);
  res.json({ success: true, image: shape.image(rows[0]) });
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
      `SELECT * FROM images ${where} ORDER BY "timestamp" DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
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
