import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { placeOrderSchema, statusUpdateSchema } from '../validators/schemas.js';
import { createOrder, updateOrderStatus } from '../services/orderService.js';

const ORDER_SELECT = `
  id, order_number, customer_name, phone, college, notes,
  subtotal, discount, total, coupon_code, payment_method, payment_status,
  order_status, created_at, updated_at,
  order_items ( id, product_name, price, quantity, subtotal )
`;

/**
 * Customer: place a COD order. All money/validation done server-side
 * inside the place_order DB transaction. Idempotency key prevents dupes.
 */
export const placeOrder = asyncHandler(async (req, res) => {
  const body = placeOrderSchema.parse(req.body);

  const result = await createOrder({
    customerId: req.user.id,
    items: body.items,
    couponCode: body.coupon_code,
    notes: body.notes,
    idempotencyKey: body.idempotency_key,
  });

  res.status(result.reused ? 200 : 201).json({ order: result });
});

/**
 * Customer: list own orders.
 */
export const myOrders = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(ORDER_SELECT)
    .eq('customer_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(500, 'Could not load your orders.');
  res.json({ orders: data });
});

/**
 * Customer/admin: get one order. Customers may only see their own.
 */
export const getOrder = asyncHandler(async (req, res) => {
  const isAdmin = req.profile.role === 'admin';
  let query = supabaseAdmin.from('orders').select(ORDER_SELECT).eq('id', req.params.id);
  if (!isAdmin) query = query.eq('customer_id', req.user.id);

  const { data, error } = await query.single();
  if (error || !data) throw ApiError.notFound('Order not found.');
  res.json({ order: data });
});

/* ------------------------- Admin ------------------------- */

export const listOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;
  let query = supabaseAdmin
    .from('orders')
    .select(ORDER_SELECT)
    .eq('restaurant_id', env.restaurantId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('order_status', status);

  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Could not load orders.');
  res.json({ orders: data });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const { status } = statusUpdateSchema.parse(req.body);
  const updated = await updateOrderStatus(req.params.id, status);
  res.json({ order: updated });
});

/**
 * Admin dashboard summary for "today" (Asia/Kolkata).
 */
export const dashboardSummary = asyncHandler(async (_req, res) => {
  // Start of today in IST, expressed as a UTC timestamp for the query.
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const istMidnight = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  const startUtc = new Date(istMidnight.getTime() - istOffsetMs).toISOString();

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('order_status, total, created_at')
    .eq('restaurant_id', env.restaurantId)
    .gte('created_at', startUtc);
  if (error) throw new ApiError(500, 'Could not load dashboard.');

  const summary = {
    today_orders: data.length,
    today_sales: 0,
    counts: { PLACED: 0, ACCEPTED: 0, PREPARING: 0, OUT_FOR_DELIVERY: 0, DELIVERED: 0, CANCELLED: 0 },
  };
  for (const o of data) {
    summary.counts[o.order_status] = (summary.counts[o.order_status] || 0) + 1;
    if (o.order_status !== 'CANCELLED') summary.today_sales += Number(o.total);
  }
  summary.today_sales = Math.round(summary.today_sales * 100) / 100;
  summary.pending = summary.counts.PLACED;
  res.json({ summary });
});
