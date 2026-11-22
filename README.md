# A.M. Oxford API (Supabase PostgreSQL + Cloudflare R2)

Replacement for `amoxfordschoolserver` (MongoDB + images on disk). **Same endpoints and
same JSON responses**, so the admin panel and website need no changes.

| | Old server | This project |
| --- | --- | --- |
| Database | MongoDB on the VPS | PostgreSQL on Supabase (free tier) |
| Images | `public/Images` on the VPS | Cloudflare R2 bucket on a custom domain |
| Port on VPS | 8080 | 8081 |
| pm2 name | `server` | `amoxford-api` |

Migrated rows keep their MongoDB ids, so existing admin logins (same `SECRET_KEY`), reset
links and URLs keep working. Old image URLs (`/Images/...`) redirect (301) to R2.

## Layout

```
db/schema.sql                  tables + RLS (safe to re-run)
src/server.js                  app setup
src/db.js                      pg pool (SSL for Supabase), id generator, row -> API JSON shapes
src/storage.js                 R2 upload/delete, sharp resize + thumbnail
src/auth.js                    admin JWT check, async error wrapper
src/guard.js                   enquiry validation + per-IP rate limit (npm test = self-check)
src/routes/*.js                auth, notices, enquiries, images, categories, dashboard
scripts/apply-schema.js        npm run db:schema: create tables in DATABASE_URL
scripts/migrate-from-mongo.js  copy MongoDB -> PostgreSQL (re-runnable)
scripts/upload-images-to-r2.js copy images folder -> R2 (re-runnable)
```

## Supabase notes

- **Connection string:** use the **Session pooler** (port 5432) from Project Settings >
  Database. The direct host is IPv6-only on the free tier and the VPS connects over IPv4.
- **Region:** pick the one closest to the VPS (every query crosses the network).
- **RLS:** `db/schema.sql` turns on Row Level Security with no policies, so Supabase's
  public Data API (anon key) cannot read any table. This server connects as the table
  owner and is not affected. Do not add policies unless you mean to expose data.
- **Free tier limits:** 500 MB database (this data is well under 1 MB), and a project is
  **paused after 7 days without activity**. The server reads a table every 12 hours
  (keep-alive in `src/server.js`), and the website queries the database on every visit.
- **Backups:** the free tier has no downloadable backups. Optional: a weekly `pg_dump` from
  the VPS (`apt install postgresql-client`, client only, no server).

## One-time setup

1. **Supabase:** create a project, copy the Session pooler connection string.
2. **Cloudflare R2:** create bucket `amoxford-images`, connect custom domain
   `images.amoxford.com`, create an API token with Object Read & Write on that bucket only.
3. **App on the VPS**
   ```
   git clone <repo> /root/amoxford-api && cd /root/amoxford-api
   npm ci
   cp .env.example .env   # fill in; copy SECRET_KEY, MAIL_* from the old server's .env
   npm run db:schema      # creates tables in Supabase, prints RLS status
   ```
4. **Copy data and images** (both safe to re-run)
   ```
   npm run migrate:mongo
   npm run migrate:images -- /root/amoxfordschoolserver/public/Images
   ```
   Both print counts and exit with an error if anything is missing.
5. **Run next to the old server**
   ```
   pm2 start src/server.js --name amoxford-api && pm2 save
   ```
6. **Test** through a staging domain (e.g. `api-staging.amoxford.com` -> `localhost:8081`),
   with a local admin panel pointed at it (`VITE_API_URL`). Check every page.

## Cutover (about 5 minutes)

1. Re-run `npm run migrate:mongo` and `npm run migrate:images -- <folder>` to copy
   anything added since step 4.
2. In `/etc/nginx/sites-available/api.amoxford.com.conf` change
   `proxy_pass http://localhost:8080;` to `http://localhost:8081;`, then
   `nginx -t && systemctl reload nginx`.
3. Check `https://api.amoxford.com/`, the admin panel and the website.

**Rollback:** set `proxy_pass` back to 8080 and reload nginx. MongoDB is untouched.
Keep the old server stopped but installed for 2-4 weeks, then remove it.

## Deploy updates

```
ssh root@77.37.45.210 '. ~/.nvm/nvm.sh && cd /root/amoxford-api && git pull && npm ci && pm2 restart amoxford-api'
```
