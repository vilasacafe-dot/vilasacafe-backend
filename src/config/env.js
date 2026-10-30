import dotenv from 'dotenv';

dotenv.config();

/**
 * Central, validated environment configuration.
 * Throws on startup if a required secret is missing so we fail fast.
 */
function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name, fallback = undefined) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '4000'), 10),

  // Comma-separated list of allowed browser origins.
  // When deployed on Vercel (VERCEL=1 is set automatically), fall back to the
  // known production frontend origins if CORS_ORIGINS is not explicitly configured
  // in the Vercel dashboard. Set CORS_ORIGINS in the dashboard to override this.
  corsOrigins: optional(
    'CORS_ORIGINS',
    process.env.VERCEL === '1'
      ? 'https://vilasacafe.com,https://www.vilasacafe.com'
      : 'http://localhost:5173'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  restaurantId: required('VILASA_RESTAURANT_ID'),

  r2: {
    accountId: required('R2_ACCOUNT_ID'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucket: required('R2_BUCKET_NAME'),
    // Public base URL (custom domain or r2.dev). No trailing slash.
    publicUrl: required('R2_PUBLIC_URL').replace(/\/+$/, ''),
  },

  upload: {
    maxFileBytes: parseInt(optional('MAX_UPLOAD_BYTES', '8388608'), 10), // 8 MB
  },
};

export const isProd = env.nodeEnv === 'production';
