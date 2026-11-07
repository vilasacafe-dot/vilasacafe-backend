import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { rewardCampaignSchema, rewardCampaignUpdateSchema } from '../validators/schemas.js';
import { getCustomerRewards } from '../services/rewardService.js';

/* ───────────────────────── Customer ───────────────────────── */

/**
 * Customer: live reward progress for active campaigns + any unlocked coupons.
 * Progress is computed from actual delivered orders (never a client counter).
 */
export const myRewards = asyncHandler(async (req, res) => {
  const rewards = await getCustomerRewards(req.user.id);
  res.json({ rewards });
});

/* ─────────────────────────── Admin ─────────────────────────── */

export const listCampaigns = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('reward_campaigns')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, 'Could not load reward campaigns.');
  res.json({ campaigns: data });
});

export const createCampaign = asyncHandler(async (req, res) => {
  const fields = rewardCampaignSchema.parse(req.body);
  // Mirror into the legacy required_orders column so the row stays valid
  // regardless of migration order (the column is otherwise unused now).
  const row = { ...fields, required_orders: fields.required_streak_days, restaurant_id: env.restaurantId };

  const { data, error } = await supabaseAdmin
    .from('reward_campaigns')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Could not create reward campaign.');
  res.status(201).json({ campaign: data });
});

export const updateCampaign = asyncHandler(async (req, res) => {
  const fields = rewardCampaignUpdateSchema.parse(req.body);
  if (fields.required_streak_days !== undefined) {
    fields.required_orders = fields.required_streak_days; // keep legacy column in sync
  }

  const { data, error } = await supabaseAdmin
    .from('reward_campaigns')
    .update(fields)
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .select('*')
    .single();
  if (error || !data) throw ApiError.notFound('Reward campaign not found.');
  res.json({ campaign: data });
});

export const deleteCampaign = asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('reward_campaigns')
    .delete()
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId);
  if (error) throw new ApiError(500, 'Could not delete reward campaign.');
  res.json({ ok: true });
});
