import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Verify the Supabase access token from the Authorization header,
 * attach req.user (auth user) and req.profile (profiles row).
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw ApiError.unauthorized();

  // Validate the token against Supabase auth.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw ApiError.unauthorized('Session expired. Please sign in again.');

  req.user = data.user;
  req.accessToken = token;

  // Load the profile (created by the DB trigger on signup).
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw ApiError.unauthorized('Profile not found. Please sign in again.', 'PROFILE_MISSING');
  }
  req.profile = profile;
  next();
});

/**
 * Require the authenticated user to be an admin.
 */
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  if (!req.profile || req.profile.role !== 'admin') {
    throw ApiError.forbidden('Admin access required.');
  }
  next();
});
