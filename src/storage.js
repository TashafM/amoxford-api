// Cloudflare R2 (S3-compatible) image storage.
// Layout: <filename> = full image, thumbs/<filename> = 400x300 grid preview,
//         uploads/<id>/<name> = raw browser uploads waiting to be processed.
const sharp = require("sharp");
const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const bucket = process.env.R2_BUCKET;
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const thumbKey = (filename) => `thumbs/${filename}`;

// Public URL on the bucket's custom domain, e.g. https://images.amoxford.com/<key>
const publicUrl = (key) =>
  `${process.env.R2_PUBLIC_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;

const put = (key, body) =>
  r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "image/webp",
    // Filenames are unique and never overwritten, so browsers and the CDN can cache forever.
    CacheControl: "public, max-age=31536000, immutable",
  }));

const get = async (key) => {
  const res = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
};

const remove = (keys) =>
  r2.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })) },
  }));

// Full image capped at 1920px (phone photos are ~4000px) + small grid thumbnail.
// `rotate` = extra clockwise degrees; with no value, applies EXIF orientation.
async function processImage(input, rotate) {
  const base = () => (rotate ? sharp(input).rotate(rotate) : sharp(input).rotate());
  const [full, thumb] = await Promise.all([
    base().resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: rotate ? 70 : 40 }) // re-encode of a rotate: higher quality limits loss
      .toBuffer(),
    base().resize(400, 300, { fit: "cover" }).webp({ quality: 50, effort: 6 }).toBuffer(),
  ]);
  return { full, thumb };
}

// Store both versions under `filename`.
async function saveImage(filename, { full, thumb }) {
  await Promise.all([put(filename, full), put(thumbKey(filename), thumb)]);
}

const deleteImage = (filename) => remove([filename, thumbKey(filename)]);

// Signed link the browser uses to PUT one file straight to R2 (Vercel caps request bodies
// at 4.5 MB, phone photos are bigger). Content-Type and exact size are part of the
// signature, so the browser cannot upload a different type or a larger file with it.
const presignUpload = (key, contentType, size) =>
  getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size }),
    { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length"]) }
  );

module.exports = {
  r2, bucket, put, get, remove, publicUrl, processImage, saveImage, deleteImage, presignUpload,
};
