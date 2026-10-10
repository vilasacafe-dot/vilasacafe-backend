import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

/**
 * Cloudflare R2 is S3-compatible. The endpoint is derived from the account id.
 * Region must be 'auto' for R2.
 */
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2.accessKeyId,
    secretAccessKey: env.r2.secretAccessKey,
  },
});

export const R2_BUCKET = env.r2.bucket;
export const R2_PUBLIC_URL = env.r2.publicUrl;
