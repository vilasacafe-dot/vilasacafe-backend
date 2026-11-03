import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Create a web order atomically via the place_order DB function.
 */
export async function createOrder({ customerId, items, couponCode, notes, idempotencyKey }) {
  const { data, error } = await supabaseAdmin.rpc('place_order', {
    p_customer_id:     customerId,
    p_restaurant_id:   env.restaurantId,
    p_items:           items,
    p_coupon_code:     couponCode     || null,
    p_notes:           notes          || null,
    p_idempotency_key: idempotencyKey || null,
  });
  if (error) {
    console.error('place_order RPC error:', error);
    throw new ApiError(400, error.message || 'Could not place order.', error.code);
  }
  return data;
}

/**
 * Create a phone / counter order via the place_phone_order DB function.
 * Bypasses profile checks — admin-only.
 */
export async function createPhoneOrder({
  adminId, customerName, phone, college, items, notes, idempotencyKey,
}) {
  const { data, error } = await supabaseAdmin.rpc('place_phone_order', {
    p_admin_id:        adminId,
    p_restaurant_id:   env.restaurantId,
    p_items:           items,
    p_customer_name:   customerName  || null,
    p_phone:           phone         || null,
    p_college:         college,
    p_notes:           notes         || null,
    p_idempotency_key: idempotencyKey || null,
  });
  if (error) {
    console.error('place_phone_order RPC error:', error);
    throw new ApiError(400, error.message || 'Could not save phone order.', error.code);
  }
  return data;
}

/**
 * Admin: update order status with a valid forward transition.
 */
const ALLOWED_NEXT = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export async function updateOrderStatus(orderId, nextStatus) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_status')
    .eq('id', orderId)
    .eq('restaurant_id', env.restaurantId)
    .single();

  if (error || !order) throw ApiError.notFound('Order not found.');

  const allowed = ALLOWED_NEXT[order.order_status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(
      `Cannot change status from ${order.order_status} to ${nextStatus}.`
    );
  }

  const patch = { order_status: nextStatus };
  if (nextStatus === 'DELIVERED') patch.payment_status = 'PAID';

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('orders')
    .update(patch)
    .eq('id', orderId)
    .select('*')
    .single();

  if (updateError) throw new ApiError(500, 'Could not update order.');
  return updated;
}
