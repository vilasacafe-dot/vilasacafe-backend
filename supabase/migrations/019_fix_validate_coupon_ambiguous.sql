-- ============================================================
-- Vilasa Cafe — 019_fix_validate_coupon_ambiguous.sql
--
-- Fix: "column reference \"coupon_id\" is ambiguous" raised by validate_coupon
-- whenever a coupon has a per_user_limit set.
--
-- Cause: the function's RETURNS TABLE declares an OUT column named `coupon_id`.
-- The per-user usage check queried `coupon_usages` with UNQUALIFIED column names
-- (`where coupon_id = c.id and customer_id = p_customer_id`), which Postgres
-- could not disambiguate from the OUT column — so the whole RPC errored.
--
-- This surfaced as "Coupon Validation Failed" for EVERY reward coupon (reward
-- coupons always set per_user_limit = 1). It also affected any admin coupon that
-- used a per-user limit.
--
-- Fix: qualify the columns as coupon_usages.coupon_id / coupon_usages.customer_id
-- (as the original 011 migration did). Behaviour is otherwise identical to 018:
-- ownership check, daily cutoff, limits, eligibility and discount math preserved.
-- Return signature unchanged, so no DROP is required.
--
-- Safe to run once in the Supabase SQL editor.
-- ============================================================

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
    -- Qualify with the table name so the OUT column `coupon_id` is not ambiguous.
    select count(*) into user_uses
    from coupon_usages
    where coupon_usages.coupon_id = c.id
      and coupon_usages.customer_id = p_customer_id;
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
