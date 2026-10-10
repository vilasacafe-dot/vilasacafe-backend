import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { bannerSchema } from '../validators/schemas.js';
import { deleteObject } from '../services/imageService.js';

/**
 * Public: active banners for the homepage carousel (max 3).
 */
export const listActiveBanners = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('hero_banners')
    .select('id, title, image_url, link_url, display_order')
    .eq('restaurant_id', env.restaurantId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .limit(3);
  if (error) throw new ApiError(500, 'Could not load banners.');
  res.json({ banners: data });
});

/* ------------------------- Admin ------------------------- */

export const listAllBanners = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('hero_banners')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .order('display_order', { ascending: true });
  if (error) throw new ApiError(500, 'Could not load banners.');
  res.json({ banners: data });
});

export const createBanner = asyncHandler(async (req, res) => {
  const body = bannerSchema.parse(req.body);
  const { data, error } = await supabaseAdmin
    .from('hero_banners')
    .insert({ ...body, restaurant_id: env.restaurantId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23514' || /active banners/i.test(error.message || '')) {
      throw ApiError.badRequest('Maximum of 3 active banners allowed. Deactivate one first.');
    }
    throw new ApiError(500, 'Could not create banner.');
  }
  res.status(201).json({ banner: data });
});

export const updateBanner = asyncHandler(async (req, res) => {
  const body = bannerSchema.partial().parse(req.body);

  let oldKey = null;
  if (body.image_key !== undefined) {
    const { data: existing } = await supabaseAdmin
      .from('hero_banners')
      .select('image_key')
      .eq('id', req.params.id)
      .eq('restaurant_id', env.restaurantId)
      .single();
    if (existing?.image_key && existing.image_key !== body.image_key) oldKey = existing.image_key;
  }

  const { data, error } = await supabaseAdmin
    .from('hero_banners')
    .update(body)
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23514' || /active banners/i.test(error?.message || '')) {
      throw ApiError.badRequest('Maximum of 3 active banners allowed. Deactivate one first.');
    }
    throw ApiError.notFound('Banner not found.');
  }
  if (oldKey) await deleteObject(oldKey);
  res.json({ banner: data });
});

export const deleteBanner = asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('hero_banners')
    .select('image_key')
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .single();

  const { error } = await supabaseAdmin
    .from('hero_banners')
    .delete()
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId);
  if (error) throw new ApiError(500, 'Could not delete banner.');

  if (existing?.image_key) await deleteObject(existing.image_key);
  res.json({ ok: true });
});
