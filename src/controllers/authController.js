import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { profileSchema } from '../validators/schemas.js';

/**
 * Return the current user's profile + completeness flag.
 */
export const getMe = asyncHandler(async (req, res) => {
  const p = req.profile;
  const complete = Boolean(p.full_name && p.phone && p.college);
  res.json({ profile: p, complete });
});

/**
 * Complete/update the current user's profile.
 * Customers cannot change their own role (ignored here).
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const parsed = profileSchema.parse(req.body);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      full_name: parsed.full_name,
      phone: parsed.phone,
      college: parsed.college,
    })
    .eq('id', req.user.id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23514') {
      throw ApiError.badRequest('Enter a valid 10-digit Indian mobile number.');
    }
    throw new ApiError(500, 'Could not update profile.');
  }

  res.json({ profile: data, complete: true });
});
