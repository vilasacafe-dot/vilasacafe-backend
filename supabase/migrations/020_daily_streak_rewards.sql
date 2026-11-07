-- ============================================================
-- Vilasa Cafe — 020_daily_streak_rewards.sql
--
-- Evolve the reward system from "milestone" (complete N orders in a window)
-- to "daily streak" (complete at least one eligible DELIVERED order on Y
-- different calendar days within an X-day window). This REUSES the existing
-- reward_campaigns + customer_reward_cycles tables and the coupon integration
-- (assigned_customer_id, validate_coupon) — no new tables, no new coupon system.
--
-- Streak days are computed deterministically from the orders table
-- (distinct Asia/Kolkata delivered dates), which is the reliable, drift-free
-- "streak-day record": one DB-side source of truth, and the same calendar day
-- can never be counted twice. Completed cycles are still persisted in
-- customer_reward_cycles with a unique (campaign, customer, cycle_index) guard
-- so each completed cycle generates at most one coupon.
--
-- Additive and non-destructive: existing campaigns, cycles, coupons and reward
-- history are preserved. Safe to run once in the Supabase SQL editor.
-- ============================================================

-- 1. Required streak DAYS (Y). duration_days continues to mean the window (X).
alter table reward_campaigns
  add column if not exists required_streak_days integer;

-- Backfill existing rows so they remain valid under the streak model.
update reward_campaigns
   set required_streak_days = coalesce(required_streak_days, required_orders, 1)
 where required_streak_days is null;

alter table reward_campaigns
  alter column required_streak_days set not null;

do $$ begin
  alter table reward_campaigns
    add constraint chk_required_streak_days check (required_streak_days > 0);
exception when duplicate_object then null; end $$;

-- 2. The legacy milestone column is no longer required for new (streak)
--    campaigns. Keep it (non-destructive) but make it optional. The backend
--    still mirrors it for backward compatibility.
alter table reward_campaigns
  alter column required_orders drop not null;

-- 3. Targeted index to speed the per-customer eligible-orders lookup used by
--    the streak calculation (DELIVERED + WEB, by customer, by delivered_at).
create index if not exists idx_orders_streak_eligible
  on orders (customer_id, delivered_at)
  where order_status = 'DELIVERED' and source = 'WEB';
