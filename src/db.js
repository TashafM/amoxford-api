const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = (text, params) => pool.query(text, params);

// Same 24-hex format as MongoDB ObjectIds (4-byte time + 8 random bytes),
// so new rows look like migrated ones to both frontends.
const newId = () =>
  Math.floor(Date.now() / 1000).toString(16).padStart(8, "0") +
  crypto.randomBytes(8).toString("hex");

// Row -> the exact JSON shape the old MongoDB API returned.
const shape = {
  image: (r) => ({ _id: r.id, filename: r.filename, category: r.category, timestamp: r.timestamp }),
  notice: (r) => ({
    _id: r.id, date: r.date, notice: r.notice, createdAt: r.created_at, updatedAt: r.updated_at,
  }),
  enquiry: (r) => ({
    _id: r.id, name: r.name, phone_number: r.phone_number, message: r.message,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }),
  category: (r) => ({ _id: r.id, name: r.name, bannerImage: r.banner_image, slug: r.slug }),
};

module.exports = { pool, query, newId, shape };
