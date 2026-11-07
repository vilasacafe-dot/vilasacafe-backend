import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministically segment a customer's eligible completed orders into reward
 * cycles for one campaign.
 *
 * Model (confirmed): a PER-CUSTOMER rolling window of `duration_days` anchored
 * at the first completed order of each cycle. A cycle needs `required_orders`
 * completed orders inside its window. Cycles REPEAT. Only DELIVERED web orders
 * that were delivered while the campaign was active count.
 *
 * The segmentation is append-only and therefore idempotent: delivered_at only
 * ever moves forward in time, so completed/expired cycles (whose windows are in
 * the past) never change when new orders arrive — only the current open window
 * can advance to completion.
 *
 * @param {object} campaign  reward_campaigns row
 * @param {{id:string, delivered_at:string}[]} deliveredOrders
 * @param {Date} now
 * @returns {{ completed: Array, current: object }}
 */
export function computeCampaignState(campaign, deliveredOrders, now = new Date()) {
  const required = campaign.required_orders;
  const durationMs = campaign.duration_days * DAY_MS;
  const nowMs = now.getTime();

  const startBound = campaign.starts_at ? new Date(campaign.starts_at).getTime() : -Infinity;
  const endBound = campaign.ends_at ? new Date(campaign.ends_at).getTime() : Infinity;

  const orders = deliveredOrders
    .filter((o) => o.delivered_at)
    .map((o) => ({ id: o.id, t: new Date(o.delivered_at).getTime() }))
    .filter((o) => o.t >= startBound && o.t <= endBound)
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));

  const completed = [];
  let current = {
    status: 'idle',
    completed: 0,
    required,
    cycle_index: 1,
    window_start: null,
    window_end: null,
  };

  let i = 0;
  let cycleIndex = 0;

  while (i < orders.length) {
    const anchorMs = orders[i].t;
    const windowEndMs = anchorMs + durationMs;

    // Count consecutive unconsumed orders (from i) that fall inside the window.
    let j = i;
    let count = 0;
    while (j < orders.length && orders[j].t <= windowEndMs) {
      count += 1;
      if (count === required) break;
      j += 1;
    }

    if (count === required) {
      cycleIndex += 1;
      completed.push({
        cycle_index: cycleIndex,
        window_start: new Date(anchorMs).toISOString(),
        window_end: new Date(windowEndMs).toISOString(),
        completed_at: new Date(orders[j].t).toISOString(),
      });
      i = j + 1;
      continue;
    }

    // Not enough orders inside the window.
    if (windowEndMs < nowMs) {
      // Window has closed without completing — a lapsed attempt. Consume the
      // in-window orders and look past them for a fresh anchor.
      cycleIndex += 1;
      current = {
        status: 'expired',
        completed: count,
        required,
        cycle_index: cycleIndex,
        window_start: new Date(anchorMs).toISOString(),
        window_end: new Date(windowEndMs).toISOString(),
      };
      let k = i;
      while (k < orders.length && orders[k].t <= windowEndMs) k += 1;
      i = k;
      continue;
    }

    // Window still open — this is the live, in-progress cycle.
    cycleIndex += 1;
    current = {
      status: 'in_progress',
      completed: count,
      required,
      cycle_index: cycleIndex,
      window_start: new Date(anchorMs).toISOString(),
      window_end: new Date(windowEndMs).toISOString(),
    };
    break;
  }

  // Everything consumed by completed cycles and nothing pending → ready to
  // start a fresh streak on the next order.
  if (i >= orders.length && current.status === 'idle') {
    current = {
      status: 'idle',
      completed: 0,
      required,
      cycle_index: cycleIndex + 1,
      window_start: null,
      window_end: null,
    };
  }

  return { completed, current };
}

/** Load a customer's eligible (DELIVERED, source='WEB') orders once. */
async function loadDeliveredOrders(customerId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('id, delivered_at')
    .eq('customer_id', customerId)
    .eq('restaurant_id', env.restaurantId)
    .eq('source', 'WEB')
    .eq('order_status', 'DELIVERED')
    .not('delivered_at', 'is', null);
  if (error) throw error;
  return data || [];
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let s = '';
  for (let k = 0; k < 6; k += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `REWARD-${s}`;
}

/**
 * Create the personal, non-transferable reward coupon for a completed cycle.
 * Reuses the existing coupons table so redemption flows through validate_coupon
 * / place_order unchanged. Retries on code collisions.
 */
async function generateRewardCoupon(campaign, customerId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + campaign.coupon_validity_days * DAY_MS);

  const base = {
    restaurant_id: env.restaurantId,
    description: `Reward unlocked: ${campaign.name}`,
    discount_type: campaign.discount_type,
    discount_value: campaign.discount_value,
    min_order_value: campaign.min_order_value || 0,
    max_discount: campaign.discount_type === 'percentage' ? campaign.max_discount : null,
    target: 'all',
    starts_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    is_active: true,
    usage_limit: 1,
    per_user_limit: 1,
    assigned_customer_id: customerId,
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .insert({ ...base, code: randomCode() })
      .select('*')
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // not a duplicate-code collision
  }
  throw new Error('Could not generate a unique reward coupon code.');
}

/**
 * Idempotently materialise every COMPLETED reward cycle for a customer into a
 * persisted row + a personal coupon. Safe to call repeatedly (and from both the
 * delivery trigger and the read endpoint): the unique (campaign, customer,
 * cycle_index) constraint prevents duplicate rewards.
 */
export async function evaluateForCustomer(customerId) {
  const now = new Date();

  const { data: campaigns, error: campErr } = await supabaseAdmin
    .from('reward_campaigns')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .eq('is_active', true);
  if (campErr) throw campErr;

  const active = (campaigns || []).filter(
    (c) => (!c.starts_at || new Date(c.starts_at) <= now) && (!c.ends_at || new Date(c.ends_at) >= now)
  );
  if (active.length === 0) return;

  const orders = await loadDeliveredOrders(customerId);

  for (const campaign of active) {
    const { completed } = computeCampaignState(campaign, orders, now);
    if (completed.length === 0) continue;

    // Which cycle indices are already persisted for this customer?
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('customer_reward_cycles')
      .select('id, cycle_index, coupon_id')
      .eq('campaign_id', campaign.id)
      .eq('customer_id', customerId);
    if (exErr) throw exErr;

    const byIndex = new Map((existing || []).map((r) => [r.cycle_index, r]));

    for (const cycle of completed) {
      const already = byIndex.get(cycle.cycle_index);

      // Fully materialised already — nothing to do.
      if (already && already.coupon_id) continue;

      if (!already) {
        // Claim the cycle first (unique constraint makes this the dedup point).
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from('customer_reward_cycles')
          .insert({
            campaign_id: campaign.id,
            customer_id: customerId,
            cycle_index: cycle.cycle_index,
            window_start: cycle.window_start,
            window_end: cycle.window_end,
            status: 'unlocked',
            unlocked_at: now.toISOString(),
          })
          .select('id')
          .single();

        if (insErr) {
          // 23505 = another concurrent delivery already claimed this cycle.
          if (insErr.code === '23505') continue;
          throw insErr;
        }

        const coupon = await generateRewardCoupon(campaign, customerId);
        await supabaseAdmin
          .from('customer_reward_cycles')
          .update({ coupon_id: coupon.id })
          .eq('id', inserted.id);
      } else {
        // Row exists but coupon generation failed previously — finish the job.
        const coupon = await generateRewardCoupon(campaign, customerId);
        await supabaseAdmin
          .from('customer_reward_cycles')
          .update({ coupon_id: coupon.id })
          .eq('id', already.id);
      }
    }
  }
}

/**
 * Build the customer-facing rewards payload: live progress for every active
 * campaign plus any coupons already unlocked (with used / expired status).
 */
export async function getCustomerRewards(customerId) {
  const now = new Date();

  // Make sure any just-completed cycles are materialised before reading.
  try {
    await evaluateForCustomer(customerId);
  } catch (e) {
    console.error('evaluateForCustomer during read failed:', e);
  }

  const [{ data: campaigns, error: campErr }, { data: cycles, error: cycErr }, orders] =
    await Promise.all([
      supabaseAdmin
        .from('reward_campaigns')
        .select('*')
        .eq('restaurant_id', env.restaurantId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('customer_reward_cycles')
        .select('id, campaign_id, cycle_index, status, coupon_id, window_start, window_end, unlocked_at')
        .eq('customer_id', customerId),
      loadDeliveredOrders(customerId),
    ]);
  if (campErr) throw campErr;
  if (cycErr) throw cycErr;

  // Pull the coupons linked to this customer's cycles for code / status.
  const couponIds = (cycles || []).map((c) => c.coupon_id).filter(Boolean);
  let couponsById = new Map();
  if (couponIds.length > 0) {
    const { data: coupons, error: cpnErr } = await supabaseAdmin
      .from('coupons')
      .select('id, code, discount_type, discount_value, max_discount, min_order_value, expires_at, used_count, is_active')
      .in('id', couponIds);
    if (cpnErr) throw cpnErr;
    couponsById = new Map((coupons || []).map((c) => [c.id, c]));
  }

  const cyclesByCampaign = new Map();
  for (const cyc of cycles || []) {
    if (!cyclesByCampaign.has(cyc.campaign_id)) cyclesByCampaign.set(cyc.campaign_id, []);
    cyclesByCampaign.get(cyc.campaign_id).push(cyc);
  }

  const isCampaignActive = (c) =>
    c.is_active && (!c.starts_at || new Date(c.starts_at) <= now) && (!c.ends_at || new Date(c.ends_at) >= now);

  const rewards = [];

  for (const campaign of campaigns || []) {
    const campCycles = cyclesByCampaign.get(campaign.id) || [];
    const active = isCampaignActive(campaign);

    // Only surface campaigns the customer can act on: active ones, or ended
    // ones where they still hold an unlocked coupon.
    if (!active && campCycles.length === 0) continue;

    const { current } = computeCampaignState(campaign, orders, now);

    const coupons = campCycles
      .filter((c) => c.coupon_id && couponsById.has(c.coupon_id))
      .map((c) => {
        const cp = couponsById.get(c.coupon_id);
        const expired = cp.expires_at && new Date(cp.expires_at) < now;
        const used = cp.used_count > 0;
        return {
          cycle_index: c.cycle_index,
          code: cp.code,
          discount_type: cp.discount_type,
          discount_value: Number(cp.discount_value),
          max_discount: cp.max_discount != null ? Number(cp.max_discount) : null,
          min_order_value: Number(cp.min_order_value),
          expires_at: cp.expires_at,
          unlocked_at: c.unlocked_at,
          status: used ? 'used' : expired ? 'expired' : 'active',
        };
      })
      .sort((a, b) => b.cycle_index - a.cycle_index);

    rewards.push({
      campaign_id: campaign.id,
      name: campaign.name,
      description: campaign.description || '',
      duration_days: campaign.duration_days,
      required_orders: campaign.required_orders,
      discount_type: campaign.discount_type,
      discount_value: Number(campaign.discount_value),
      max_discount: campaign.max_discount != null ? Number(campaign.max_discount) : null,
      min_order_value: Number(campaign.min_order_value),
      coupon_validity_days: campaign.coupon_validity_days,
      active,
      progress: active
        ? {
            status: current.status, // 'in_progress' | 'expired' | 'idle'
            completed: current.completed,
            required: current.required,
            window_start: current.window_start,
            window_end: current.window_end,
          }
        : { status: 'ended', completed: 0, required: campaign.required_orders, window_start: null, window_end: null },
      coupons,
    });
  }

  return rewards;
}
