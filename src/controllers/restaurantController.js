import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { z } from 'zod';

/**
 * Public: restaurant info + open/closed status.
 */
export const getStatus = asyncHandler(async (_req, res) => {
  const { data: restaurant } = await supabaseAdmin
    .from('restaurants')
    .select('id, name, slug, phone, address')
    .eq('id', env.restaurantId)
    .single();

  const { data: settings } = await supabaseAdmin
    .from('restaurant_settings')
    .select('is_open, closed_message, min_order_value')
    .eq('restaurant_id', env.restaurantId)
    .single();

  if (!restaurant || !settings) throw ApiError.notFound('Restaurant not configured.');

  res.json({ restaurant, settings });
});

const settingsSchema = z.object({
  is_open: z.boolean().optional(),
  closed_message: z.string().trim().max(200).optional(),
  min_order_value: z.number().nonnegative().optional(),
});

/**
 * Admin: toggle open/closed + related settings.
 */
export const updateSettings = asyncHandler(async (req, res) => {
  const patch = settingsSchema.parse(req.body);
  if (Object.keys(patch).length === 0) throw ApiError.badRequest('Nothing to update.');

  const { data, error } = await supabaseAdmin
    .from('restaurant_settings')
    .update(patch)
    .eq('restaurant_id', env.restaurantId)
    .select('is_open, closed_message, min_order_value')
    .single();

  if (error) throw new ApiError(500, 'Could not update settings.');
  res.json({ settings: data });
});
