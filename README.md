# A.M. Oxford API (PostgreSQL + Cloudflare R2)

Replacement for `amoxfordschoolserver` (MongoDB + images on disk). **Same endpoints and
same JSON responses**, so the admin panel and website need no changes.

| | Old server | This project |
| --- | --- | --- |
| Database | MongoDB | PostgreSQL |
| Images | `public/Images` on the VPS | Cloudflare R2 bucket on a custom domain |
| Port on VPS | 8080 | 8081 |
| pm2 name | `server` | `amoxford-api` |

Migrated rows keep their MongoDB ids, so existing admin logins (same `SECRET_KEY`), reset
links and URLs keep working. Old image URLs (`/Images/...`) redirect (301) to R2.

## Layout

```
db/schema.sql                 tables (safe to re-run)
src/server.js                 app setup
src/db.js                     pg pool, id generator, row -> API JSON shapes
src/storage.js                R2 upload/delete, sharp resize + thumbnail
src/auth.js                   admin JWT check, async error wrapper
src/guard.js                  enquiry validation + per-IP rate limit (npm test = self-check)
src/routes/*.js               auth, notices, enquiries, images, categories, dashboard
scripts/migrate-from-mongo.js copy MongoDB -> PostgreSQL (re-runnable)
scripts/upload-images-to-r2.js copy images folder -> R2 (re-runnable)
```

## One-time setup on the VPS

1. **PostgreSQL**
   ```
   apt install -y postgresql
   sudo -u postgres psql -c "CREATE USER amoxford WITH PASSWORD '<strong password>';"
   sudo -u postgres psql -c "CREATE DATABASE amoxford OWNER amoxford;"
   psql "postgres://amoxford:<password>@localhost:5432/amoxford" -f db/schema.sql
   ```
2. **Cloudflare R2:** create bucket `amoxford-images`, connect custom domain
   `images.amoxford.com`, create an API token with Object Read & Write on that bucket only.
3. **App**
   ```
   git clone <repo> /root/amoxford-api && cd /root/amoxford-api
   npm ci
   cp .env.example .env   # fill in; copy SECRET_KEY, MAIL_* from the old server's .env
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
