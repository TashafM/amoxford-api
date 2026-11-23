// Local development server: npm run dev. On Vercel, api/index.js serves the app instead.
const app = require("./app");
const { pool } = require("./db");

const port = process.env.PORT || 8081;
pool.query("SELECT 1")
  .then(() => app.listen(port, () => console.log(`API on http://localhost:${port}, database connected`)))
  .catch((err) => {
    console.error("Cannot connect to PostgreSQL:", err.message);
    process.exit(1);
  });
