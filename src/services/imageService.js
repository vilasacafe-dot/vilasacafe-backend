import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '../config/r2.js';
import { ApiError } from '../utils/ApiError.js';

const PRESETS = {
  product: { width: 800, height: 800, fit: 'inside', quality: 80 },
  banner: { width: 1600, height: 700, fit: 'cover', quality: 82 },
};

/**
 * Validate + compress + convert an image buffer to WebP, then upload to R2.
 * Returns { key, url }.
 *
 * @param {Buffer} buffer raw upload buffer
 * @param {'product'|'banner'} kind sizing preset + folder
 */
export async function processAndUpload(buffer, kind = 'product') {
  const preset = PRESETS[kind] || PRESETS.product;

  // Re-validate the real image content (don't trust extension/mime alone).
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new ApiError(400, 'The uploaded file is not a valid image.');
  }
  if (!meta.format) {
    throw new ApiError(400, 'Unrecognized image format.');
  }

  // Resize + convert to WebP, stripping metadata by default.
  const webp = await sharp(buffer)
    .rotate() // respect EXIF orientation before stripping metadata
    .resize({
      width: preset.width,
      height: preset.height,
      fit: preset.fit,
      withoutEnlargement: true,
    })
    .webp({ quality: preset.quality })
    .toBuffer();

  const key = `${kind}s/${new Date().getFullYear()}/${randomUUID()}.webp`;

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (e) {
    // Surface the real R2/S3 error in the server logs for diagnosis.
    console.error('R2 PutObject failed:', {
      name: e?.name,
      code: e?.Code || e?.code,
      message: e?.message,
      httpStatusCode: e?.$metadata?.httpStatusCode,
      bucket: R2_BUCKET,
      key,
    });
    throw new ApiError(502, `Image storage upload failed: ${e?.message || 'unknown error'}`);
  }

  return { key, url: `${R2_PUBLIC_URL}/${key}` };
}

/**
 * Best-effort deletion of an R2 object. Never throws — cleanup only.
 */
export async function deleteObject(key) {
  if (!key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    // ignore — orphaned objects can be cleaned up out of band
  }
}
