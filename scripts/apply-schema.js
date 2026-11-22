// Create the tables (db/schema.sql) in the database from DATABASE_URL. Safe to re-run.
// Usage: npm run db:schema
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../src/db");

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  const { rows } = await pool.query(
    "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  rows.forEach((r) => console.log(`${r.tablename.padEnd(12)} RLS ${r.rowsecurity ? "on" : "OFF"}`));
  await pool.end();
})().catch((e) => {
  console.error("Schema failed:", e.message);
  process.exit(1);
});
