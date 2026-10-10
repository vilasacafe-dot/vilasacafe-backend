import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { couponSchema, couponPreviewSchema } from '../validators/schemas.js';
import { buildLines, validateCoupon } from '../services/couponService.js';

/**
 * Customer: preview a coupon against the current cart (server-authoritative).
 */
export const previewCoupon = asyncHandler(async (req, res) => {
  const { code, items } = couponPreviewSchema.parse(req.body);
  const { subtotal, lines } = await buildLines(items);
  const result = await validateCoupon({
    customerId: req.user.id,
    code: code.trim(),
    subtotal,
    lines,
  });

  res.json({
    valid: result.valid,
    message: result.message,
    discount: Number(result.discount || 0),
    subtotal,
    total: Math.max(0, Number((subtotal - Number(result.discount || 0)).toFixed(2))),
    code: result.code || null,
  });
});

/* ------------------------- Admin ------------------------- */

async function attachTargets(coupon) {
  if (coupon.target === 'category') {
    const { data } = await supabaseAdmin
      .from('coupon_categories')
      .select('category_id')
      .eq('coupon_id', coupon.id);
    coupon.category_ids = (data || []).map((r) => r.category_id);
  } else if (coupon.target === 'product') {
    const { data } = await supabaseAdmin
      .from('coupon_products')
      .select('product_id')
      .eq('coupon_id', coupon.id);
    coupon.product_ids = (data || []).map((r) => r.product_id);
  }
  return coupon;
}

export const listCoupons = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, 'Could not load coupons.');
  const coupons = await Promise.all(data.map(attachTargets));
  res.json({ coupons });
});

async function syncTargets(couponId, target, categoryIds = [], productIds = []) {
  await supabaseAdmin.from('coupon_categories').delete().eq('coupon_id', couponId);
  await supabaseAdmin.from('coupon_products').delete().eq('coupon_id', couponId);
  if (target === 'category' && categoryIds.length) {
    await supabaseAdmin
      .from('coupon_categories')
      .insert(categoryIds.map((category_id) => ({ coupon_id: couponId, category_id })));
  }
  if (target === 'product' && productIds.length) {
    await supabaseAdmin
      .from('coupon_products')
      .insert(productIds.map((product_id) => ({ coupon_id: couponId, product_id })));
  }
}

export const createCoupon = asyncHandler(async (req, res) => {
  const body = couponSchema.parse(req.body);
  const { category_ids, product_ids, ...fields } = body;

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({ ...fields, restaurant_id: env.restaurantId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('A coupon with that code already exists.');
    throw new ApiError(500, 'Could not create coupon.');
  }

  await syncTargets(data.id, data.target, category_ids, product_ids);
  res.status(201).json({ coupon: await attachTargets(data) });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const body = couponSchema.partial().parse(req.body);
  const { category_ids, product_ids, ...fields } = body;

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .update(fields)
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23505') throw ApiError.conflict('A coupon with that code already exists.');
    throw ApiError.notFound('Coupon not found.');
  }

  if (fields.target || category_ids || product_ids) {
    await syncTargets(
      data.id,
      fields.target || data.target,
      category_ids || [],
      product_ids || []
    );
  }
  res.json({ coupon: await attachTargets(data) });
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('coupons')
    .delete()
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId);
  if (error) throw new ApiError(500, 'Could not delete coupon.');
  res.json({ ok: true });
});
