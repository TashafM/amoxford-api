# A.M. Oxford API (Vercel + Supabase PostgreSQL + Cloudflare R2)

Replacement for `amoxfordschoolserver` (MongoDB + images on the VPS). **Same endpoints and
same JSON responses**, so the admin panel and website keep working. Runs on Vercel as one
serverless function.

| | Old server | This project |
| --- | --- | --- |
| Hosting | Hostinger VPS, pm2, nginx | Vercel (serverless) |
| Database | MongoDB on the VPS | PostgreSQL on Supabase (free tier) |
| Images | `public/Images` on the VPS | Cloudflare R2 bucket `amoxford` (`s3.amoxford.com`) |
| Rate limits | in memory | `rate_limits` table in PostgreSQL |
| Uploads | multipart through the API | browser PUTs straight to R2 with a signed link |

Migrated rows keep their MongoDB ids, so existing admin logins (same `SECRET_KEY`), reset
links and URLs keep working. Old image URLs (`/Images/...`) redirect (301) to R2.

## Layout

```
api/index.js                   Vercel entry: exports the Express app
vercel.json                    rewrite everything to api/index.js, 60 s limit, daily cron
src/app.js                     Express app, /health
src/server.js                  local dev server (npm run dev)
src/db.js                      pg pool (SSL for Supabase), id generator, row -> API JSON shapes
src/storage.js                 R2 upload/delete/signed links, sharp resize + thumbnail
src/rateLimit.js               per-key rate limit in PostgreSQL, client IP
src/auth.js                    admin JWT check, async error wrapper
src/guard.js                   enquiry validation (npm test = self-check)
src/routes/*.js                auth, notices, enquiries, images, categories, dashboard
db/schema.sql                  tables + RLS (safe to re-run): npm run db:schema
scripts/migrate-from-mongo.js  copy MongoDB -> PostgreSQL (re-runnable, --fresh)
scripts/upload-images-to-r2.js copy images folder -> R2 (re-runnable)
```

## How uploads work

Vercel rejects request bodies over 4.5 MB, and phone photos are bigger. So:

1. `POST /upload-url` `{ files: [{ name, type, size }] }` (admin) returns a signed R2 link
   per file, valid 10 minutes. Type (`image/*`) and exact size (max 12 MB) are part of the
   signature.
2. The browser `PUT`s each file to its link (straight to R2, not through Vercel).
3. `POST /upload-complete` `{ key, category }` (admin), once per file: the API reads the raw
   upload, saves a 1920px version + 400x300 thumbnail, adds the image row, deletes the raw file.

`POST /upload` (multipart) still works for files under 4 MB. The admin panel tries the
direct upload first and falls back to multipart on an API that does not have it.

## Supabase notes

- **Connection string on Vercel:** the **Transaction pooler** (port 6543) with
  `DB_POOL_MAX=1`. Every serverless instance opens its own pool, so keep it small.
  Local dev and the migration scripts use the Session pooler (port 5432).
- **RLS:** turned on for every table with no policies, so Supabase's public Data API
  (anon key) cannot read anything. The API connects as the table owner and is unaffected.
- **Pausing:** free projects pause after 7 days without activity. A Vercel Cron job calls
  `/health` daily at 03:00 UTC; it reads a table and clears old rate-limit rows.
- **Backups:** the free tier has no downloadable backups. Optional: a weekly `pg_dump`.

## R2 setup

- Bucket `amoxford`, custom domain `s3.amoxford.com`.
- **CORS policy** (bucket > Settings > CORS) must allow the admin panel to PUT uploads:
  ```json
  [{
    "AllowedOrigins": ["https://admin.amoxford.com", "https://www.amoxford.com", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 86400
  }]
  ```
- **Lifecycle rule** (bucket > Settings > Object lifecycle rules): delete objects with prefix
  `uploads/` after 1 day. Cleans raw uploads left behind if a browser closes mid-upload.

## Deploy to Vercel

1. Vercel > Add New > Project > import `TashafM/amoxford-api`. Framework preset: Other.
   No build command, no output directory.
2. Environment variables (Production): everything in `.env.example` except `PORT`,
   `MONGO_URI` and `DATABASE_CA` (unless used). `DATABASE_URL` = Transaction pooler,
   `DB_POOL_MAX=1`, `SECRET_KEY` / `RESET_SECRET` / `MAIL_*` copied from the old server.
3. Deploy. Check `https://<project>.vercel.app/health`.
4. Every push to `main` deploys again.

## Cutover (about 5 minutes)

1. Re-copy everything so edits, deletes and rotations since the first copy are included
   (on the VPS, where MongoDB and the images live):
   `npm run migrate:mongo -- --fresh` and
   `npm run migrate:images -- /root/amoxfordschoolserver/public/Images`.
   Do not make changes in the admin panel between this step and step 2.
2. Point the frontends at the new API: Vercel project domain `api.amoxford.com` (Cloudflare
   DNS record for `api` as a CNAME to Vercel, DNS only / grey cloud), or change
   `VITE_API_URL` (admin) and `NEXT_PUBLIC_API_BASE_URL` (website) and redeploy them.
3. Check `/health`, the admin panel (login, upload, rotate, delete) and the website.

**Rollback:** point `api.amoxford.com` back to the VPS (`77.37.45.210`). MongoDB is untouched.

## Local development

```
npm ci
cp .env.example .env   # Session pooler URL, R2 keys, a test SECRET_KEY
npm run dev            # http://localhost:8081
```
