import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Service-role client — FULL privileges, bypasses RLS.
 * Use only on the server for privileged operations (orders, uploads,
 * admin writes). NEVER expose this key to the browser.
 */
export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

/**
 * Create a request-scoped client that acts AS the calling user, using the
 * user's access token. RLS applies. Used to verify identity and read
 * user-scoped data safely.
 */
export function supabaseForToken(accessToken) {
  return createClient(env.supabase.url, env.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
