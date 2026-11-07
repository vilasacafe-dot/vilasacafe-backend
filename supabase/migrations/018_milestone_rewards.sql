-- ============================================================
-- Vilasa Cafe — 018_milestone_rewards.sql
-- Customer Order Milestone Rewards (loyalty).
--
-- Reward campaigns let the admin say "complete N delivered orders within
-- D days and unlock a discount coupon". Progress is a PER-CUSTOMER rolling
-- window anchored at the customer's first completed order in a cycle; cycles
-- repeat so customers keep earning. When a cycle completes, a personal,
-- NON-TRANSFERABLE coupon is generated through the EXISTING coupons system.
--
-- This migration is additive and safe to run once in the Supabase SQL editor:
--   * adds orders.delivered_at       (precise completion time)
--   * adds coupons.assigned_customer_id + a check in validate_coupon
--     (binds a reward coupon to one customer — existing coupons are untouched
--      because the column is null for them)
--   * creates reward_campaigns + customer_reward_cycles
--   * RLS policies consistent with the existing coupon/order policies
-- ============================================================

-- ── 1. Precise completion timestamp on orders ───────────────────────────────
alter table orders
  add column if not exists delivered_at timestamptz;

-- Backfill already-delivered orders so they count toward rewards. updated_at
-- was bumped when the order became DELIVERED (terminal state), so it is the
-- best available approximation for historical rows.
update orders
   set delivered_at = updated_at
 where order_status = 'DELIVERED'
   and delivered_at is null;

create index if not exists idx_orders_delivered on orders(delivered_at);

-- ── 2. Bind a coupon to a single customer (reward coupons) ───────────────────
alter table coupons
  add column if not exists assigned_customer_id uuid references profiles(id) on delete cascade;

create index if not exists idx_coupons_assigned_customer on coupons(assigned_customer_id);

-- ── 3. Reward campaigns (admin configuration) ────────────────────────────────
create table if not exists reward_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  name                 text not null,
  description          text,
  -- per-customer rolling window length (7 / 15 / 30 / custom)
  duration_days        integer not null check (duration_days > 0),
  -- completed (DELIVERED, source='WEB') orders required to unlock the reward
  required_orders      integer not null check (required_orders > 0),
  -- reward discount (reuses the existing coupon discount model)
  discount_type        discount_type not null,
  discount_value       numeric(10,2) not null check (discount_value > 0),
  max_discount         numeric(10,2) check (max_discount is null or max_discount > 0),
  min_order_value      numeric(10,2) not null default 0 check (min_order_value >= 0),
  -- how long the generated coupon stays valid after it unlocks
  coupon_validity_days integer not null check (coupon_validity_days > 0),
  -- campaign's own active lifetime (optional end date)
  starts_at            timestamptz not null default now(),
  ends_at              timestamptz,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_reward_percentage_range check (
    discount_type <> 'percentage' or (discount_value > 0 and discount_value <= 100)
  ),
  constraint chk_reward_window check (ends_at is null or ends_at > starts_at)
);

create trigger trg_reward_campaigns_updated
  before update on reward_campaigns
  for each row execute function set_updated_at();

create index if not exists idx_reward_campaigns_restaurant on reward_campaigns(restaurant_id);
create index if not exists idx_reward_campaigns_active on reward_campaigns(is_active);

-- ── 4. Per-customer reward cycles (progress + unlocked coupon) ───────────────
-- Progress counts are NOT stored here (they are computed live from delivered
-- orders). A row is persisted only when a cycle COMPLETES, to (a) make coupon
-- generation idempotent and (b) remember which coupon was unlocked.
create table if not exists customer_reward_cycles (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references reward_campaigns(id) on delete cascade,
  customer_id   uuid not null references profiles(id) on delete cascade,
  cycle_index   integer not null check (cycle_index > 0),
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  status        text not null default 'unlocked'
                  check (status in ('unlocked', 'redeemed', 'expired')),
  coupon_id     uuid references coupons(id) on delete set null,
  unlocked_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One persisted cycle per (campaign, customer, index) — the dedup guard that
  -- prevents duplicate rewards / duplicate coupon generation.
  unique (campaign_id, customer_id, cycle_index)
);

create trigger trg_customer_reward_cycles_updated
  before update on customer_reward_cycles
  for each row execute function set_updated_at();

create index if not exists idx_reward_cycles_campaign_customer
  on customer_reward_cycles(campaign_id, customer_id);
create index if not exists idx_reward_cycles_customer on customer_reward_cycles(customer_id);

-- ── 5. validate_coupon: enforce reward-coupon ownership ──────────────────────
-- Re-create with an ownership check. Everything else (daily cutoff, limits,
-- eligibility, discount math) is preserved from 014. Return signature is
-- unchanged, so no DROP is required. Existing coupons have a null
-- assigned_customer_id and are therefore unaffected.
create or replace function validate_coupon(
  p_restaurant_id uuid,
  p_customer_id   uuid,
  p_code          text,
  p_subtotal      numeric,
  p_lines         jsonb
)
returns table (valid boolean, message text, discount numeric, coupon_id uuid, coupon_code text)
language plpgsql
stable
as $$
declare
  c coupons;
  eligible numeric;
  raw_discount numeric;
  user_uses integer;
  now_ist_time time := (now() at time zone 'Asia/Kolkata')::time;
begin
  select * into c
  from coupons
  where restaurant_id = p_restaurant_id
    and coupons.code = p_code
  limit 1;

  if not found then
    return query select false, 'Invalid coupon code.', 0::numeric, null::uuid, null::text; return;
  end if;

  if not c.is_active then
    return query select false, 'This coupon is no longer active.', 0::numeric, null::uuid, null::text; return;
  end if;

  -- Reward coupons are personal: only the assigned customer may redeem them.
  if c.assigned_customer_id is not null and c.assigned_customer_id <> p_customer_id then
    return query select false, 'This reward coupon is linked to a different account.', 0::numeric, null::uuid, null::text; return;
  end if;

  if now() < c.starts_at then
    return query select false, 'This coupon is not active yet.', 0::numeric, null::uuid, null::text; return;
  end if;

  if c.expires_at is not null and now() > c.expires_at then
    return query select false, 'This coupon has expired.', 0::numeric, null::uuid, null::text; return;
  end if;

  -- Daily-repeating cutoff: available every day only until daily_until (IST).
  if c.repeat_daily and c.daily_until is not null then
    if now_ist_time > c.daily_until then
      return query select false,
        'This coupon is only available until ' || to_char(c.daily_until, 'HH12:MI AM') || ' each day.',
        0::numeric, null::uuid, null::text; return;
    end if;
  end if;

  if p_subtotal < c.min_order_value then
    return query select false,
      'Minimum order value is Rs ' || trim(to_char(c.min_order_value, 'FM999999990.00')) || '.',
      0::numeric, null::uuid, null::text; return;
  end if;

  if c.usage_limit is not null and c.used_count >= c.usage_limit then
    return query select false, 'This coupon has reached its usage limit.', 0::numeric, null::uuid, null::text; return;
  end if;

  if c.per_user_limit is not null then
    select count(*) into user_uses
    from coupon_usages
    where coupon_id = c.id and customer_id = p_customer_id;
    if user_uses >= c.per_user_limit then
      return query select false, 'You have already used this coupon.', 0::numeric, null::uuid, null::text; return;
    end if;
  end if;

  eligible := coupon_eligible_subtotal(c, p_lines);
  if eligible <= 0 then
    return query select false, 'This coupon is not valid for the selected items.', 0::numeric, null::uuid, null::text; return;
  end if;

  if c.discount_type = 'percentage' then
    raw_discount := round(eligible * c.discount_value / 100.0, 2);
    if c.max_discount is not null and raw_discount > c.max_discount then
      raw_discount := c.max_discount;
    end if;
  else
    raw_discount := c.discount_value;
  end if;

  if raw_discount > eligible then
    raw_discount := eligible;
  end if;

  return query select true, 'Coupon applied.', round(raw_discount, 2), c.id, (c.code)::text;
end;
$$;

-- ── 6. Row Level Security ────────────────────────────────────────────────────
alter table reward_campaigns        enable row level security;
alter table customer_reward_cycles  enable row level security;

-- Campaigns: admin-only from the browser (customers read via the backend
-- service role through GET /api/me/rewards), mirroring the coupons policy.
drop policy if exists reward_campaigns_admin_all on reward_campaigns;
create policy reward_campaigns_admin_all on reward_campaigns
  for all using (is_admin()) with check (is_admin());

-- Cycles: a customer may read their own; admins read all. Writes happen via
-- the backend (service role) only.
drop policy if exists reward_cycles_select on customer_reward_cycles;
create policy reward_cycles_select on customer_reward_cycles
  for select using (customer_id = auth.uid() or is_admin());

drop policy if exists reward_cycles_admin_write on customer_reward_cycles;
create policy reward_cycles_admin_write on customer_reward_cycles
  for all using (is_admin()) with check (is_admin());
