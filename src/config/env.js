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

  // Allowed browser origins for CORS.
  //
  // Resolution order:
  //   1. On Vercel (VERCEL=1) or any NODE_ENV=production deployment:
  //      the two known production frontend origins are ALWAYS included.
  //      Any extra origins in the CORS_ORIGINS env var are merged in on top
  //      (useful for adding a staging domain later).
  //   2. Local development: uses CORS_ORIGINS if set, otherwise localhost:5173.
  //
  // This means the production URLs work even if CORS_ORIGINS is missing from
  // the Vercel dashboard, set to an old value, or set to localhost.
  corsOrigins: (() => {
    const fromEnv = optional('CORS_ORIGINS', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    const onVercel = process.env.VERCEL === '1';
    const inProd  = process.env.NODE_ENV === 'production';

    if (onVercel || inProd) {
      // Always allow the VilaSa Cafe production frontend.
      const productionOrigins = [
        'https://vilasacafe.com',
        'https://www.vilasacafe.com',
      ];
      // Merge: production URLs first, then any extras from the dashboard.
      return [...new Set([...productionOrigins, ...fromEnv])];
    }

    // Local dev: explicit CORS_ORIGINS or fall back to Vite dev server.
    return fromEnv.length > 0 ? fromEnv : ['http://localhost:5173'];
  })(),

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
