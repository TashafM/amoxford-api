// Upload the old server's images folder to R2, keeping the same layout:
//   <dir>/<file>        -> <file>
//   <dir>/thumbs/<file> -> thumbs/<file>
// Safe to re-run: files already in the bucket are skipped.
//
// Usage: node scripts/upload-images-to-r2.js /root/amoxfordschoolserver/public/Images
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { r2, bucket, put } = require("../src/storage");

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: node scripts/upload-images-to-r2.js <images folder>");
  process.exit(1);
}

const listLocal = (sub = "") =>
  fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listLocal(path.posix.join(sub, e.name)) : [path.posix.join(sub, e.name)]
  );

async function listRemote() {
  const keys = new Set();
  let token;
  do {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    (res.Contents || []).forEach((o) => keys.add(o.Key));
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

(async () => {
  const local = listLocal().filter((k) => /\.(webp|jpe?g|png)$/i.test(k));
  const remote = await listRemote();
  const todo = local.filter((k) => !remote.has(k));
  console.log(`local ${local.length}, already in R2 ${local.length - todo.length}, to upload ${todo.length}`);

  let done = 0, failed = 0;
  const worker = async () => {
    while (todo.length) {
      const key = todo.shift();
      try {
        await put(key, fs.readFileSync(path.join(dir, key)));
        if (++done % 50 === 0) console.log(`  ${done} uploaded`);
      } catch (e) {
        failed++;
        console.error(`  ! ${key}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const after = await listRemote();
  const missing = local.filter((k) => !after.has(k));
  console.log(`uploaded ${done}, failed ${failed}, missing in R2 ${missing.length}`);
  process.exit(missing.length ? 1 : 0);
})();
