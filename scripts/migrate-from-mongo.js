// Copy all data from the old MongoDB into PostgreSQL, keeping ids and timestamps.
// Safe to re-run: existing rows are skipped (ON CONFLICT DO NOTHING), so a second run
// right before cutover copies only what was added since the first run.
//
// Usage: MONGO_URI=... DATABASE_URL=... node scripts/migrate-from-mongo.js
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { pool } = require("../src/db");

// Mongo collection -> how to insert one document.
const PLAN = [
  {
    from: "users", table: "users",
    cols: ["id", "firstname", "lastname", "email", "password", "role", "created_at", "updated_at"],
    row: (d) => [d.firstname || "", d.lastname || "", d.email, d.password, d.role || "user", created(d), updated(d)],
  },
  {
    from: "notices", table: "notices",
    cols: ["id", "date", "notice", "created_at", "updated_at"],
    row: (d) => [String(d.date), d.notice, created(d), updated(d)],
  },
  {
    from: "forms", table: "enquiries",
    cols: ["id", "name", "phone_number", "message", "created_at", "updated_at"],
    row: (d) => [d.name, d.phone_number, d.message, created(d), updated(d)],
  },
  {
    from: "images", table: "images",
    cols: ["id", "filename", "category", "timestamp"],
    row: (d) => [d.filename, d.category || "", d.timestamp || d._id.getTimestamp()],
  },
  ...[
    ["eventcategories", "events"],
    ["extracurricularcategories", "extra-curricular"],
    ["preprimarycategories", "pre-primary"],
  ].map(([from, section]) => ({
    from, table: "categories", section,
    cols: ["id", "section", "name", "slug", "banner_image"],
    row: (d) => [section, d.name, d.slug, d.bannerImage || "#"],
  })),
];

const created = (d) => d.createdAt || d._id.getTimestamp();
const updated = (d) => d.updatedAt || created(d);

(async () => {
  const mongo = await MongoClient.connect(process.env.MONGO_URI);
  const db = mongo.db(); // database named in MONGO_URI
  let problems = 0;

  for (const step of PLAN) {
    const docs = await db.collection(step.from).find().toArray();
    const placeholders = step.cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${step.table} (${step.cols.map((c) => `"${c}"`).join(", ")})
                 VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
    let inserted = 0;
    for (const d of docs) {
      try {
        const { rowCount } = await pool.query(sql, [d._id.toString(), ...step.row(d)]);
        inserted += rowCount;
      } catch (e) {
        problems++;
        console.error(`  ! ${step.from} ${d._id}: ${e.message}`);
      }
    }
    console.log(`${step.from.padEnd(26)} mongo ${String(docs.length).padStart(4)}  new in postgres ${inserted}`);
  }

  // Final check: totals must match.
  const pairs = [
    ["users", "users"], ["notices", "notices"], ["forms", "enquiries"], ["images", "images"],
  ];
  for (const [m, p] of pairs) {
    const mc = await db.collection(m).countDocuments();
    const pc = (await pool.query(`SELECT count(*)::int AS n FROM ${p}`)).rows[0].n;
    console.log(`check ${p.padEnd(10)} mongo ${mc}  postgres ${pc}  ${mc === pc ? "OK" : "MISMATCH"}`);
    if (mc !== pc) problems++;
  }
  const catMongo = (await Promise.all(
    ["eventcategories", "extracurricularcategories", "preprimarycategories"].map((c) => db.collection(c).countDocuments())
  )).reduce((a, b) => a + b, 0);
  const catPg = (await pool.query("SELECT count(*)::int AS n FROM categories")).rows[0].n;
  console.log(`check categories mongo ${catMongo}  postgres ${catPg}  ${catMongo === catPg ? "OK" : "MISMATCH"}`);
  if (catMongo !== catPg) problems++;

  await mongo.close();
  await pool.end();
  if (problems) {
    console.error(`\n${problems} problem(s). Fix them before cutover.`);
    process.exit(1);
  }
  console.log("\nMigration complete.");
})();
