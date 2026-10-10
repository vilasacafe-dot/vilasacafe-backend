import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Build the priced "lines" array (from DB prices) for a set of cart items.
 * Used for coupon preview so the discount matches what the order will use.
 * @param {{product_id:string, quantity:number}[]} items
 */
export async function buildLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Your cart is empty.');
  }

  const ids = [...new Set(items.map((i) => i.product_id))];
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, price, category_id, is_available')
    .eq('restaurant_id', env.restaurantId)
    .in('id', ids);

  if (error) throw new ApiError(500, 'Could not load products.');

  const byId = new Map(products.map((p) => [p.id, p]));
  let subtotal = 0;
  const lines = [];

  for (const item of items) {
    const p = byId.get(item.product_id);
    const qty = Number(item.quantity);
    if (!p) throw ApiError.badRequest('One of the products is no longer available.');
    if (!Number.isInteger(qty) || qty <= 0) throw ApiError.badRequest('Invalid quantity.');

    const lineSubtotal = round2(Number(p.price) * qty);
    subtotal = round2(subtotal + lineSubtotal);
    lines.push({
      product_id: p.id,
      category_id: p.category_id,
      product_name: p.name,
      price: Number(p.price),
      quantity: qty,
      line_subtotal: lineSubtotal,
    });
  }

  return { subtotal, lines };
}

/**
 * Validate a coupon against the DB function (single source of truth).
 * Returns { valid, message, discount, coupon_id, code }.
 */
export async function validateCoupon({ customerId, code, subtotal, lines }) {
  // Pass the array directly. Supabase-js serializes it correctly for a jsonb
  // parameter. (JSON.stringify would double-encode it into a scalar string,
  // causing "cannot extract elements from a scalar" in jsonb_array_elements.)
  const { data, error } = await supabaseAdmin.rpc('validate_coupon', {
    p_restaurant_id: env.restaurantId,
    p_customer_id: customerId,
    p_code: code,
    p_subtotal: subtotal,
    p_lines: lines,
  });

  if (error) {
    console.error('validate_coupon RPC error:', error);
    throw new ApiError(500, 'Coupon validation failed. Please try again.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiError(500, 'Coupon validation returned no result.');

  // The RPC now returns `coupon_code` (renamed from `code` to avoid PG ambiguity).
  // Normalize it back to `code` for the rest of the app.
  return {
    valid:      row.valid,
    message:    row.message,
    discount:   row.discount,
    coupon_id:  row.coupon_id,
    code:       row.coupon_code ?? row.code ?? null,
  };
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
