const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const path = require("path");

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
const BUCKET = process.env.S3_BUCKET || "mysunshine-media";

/**
 * Upload a file buffer to S3.
 * Returns the S3 key (path) of the uploaded file.
 */
async function uploadFile(buffer, originalName, userId) {
  const ext = path.extname(originalName);
  const key = `${userId}/${crypto.randomUUID()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeFromExt(ext),
    })
  );

  return key;
}

/**
 * Get a time-limited download URL for a media file.
 * Default: 1 hour.
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
  return url;
}

/**
 * Delete a file from S3.
 */
async function deleteFile(key) {
  await s3.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

function mimeFromExt(ext) {
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
  };
  return map[ext.toLowerCase()] || "application/octet-stream";
}

module.exports = { uploadFile, getPresignedUrl, deleteFile };
