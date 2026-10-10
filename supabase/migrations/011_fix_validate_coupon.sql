-- ============================================================
-- Vilasa Cafe — 011_fix_validate_coupon.sql
-- Fix: "column reference code is ambiguous" in validate_coupon.
-- The return query was ambiguous between the PL/pgSQL variable
-- `c` (type coupons) and the function's OUT parameter `code`.
-- Fixed by casting explicitly: (c.code)::text
-- ============================================================

create or replace function coupon_eligible_subtotal(p_coupon coupons, p_lines jsonb)
returns numeric
language plpgsql
stable
as $$
declare
  eligible numeric := 0;
  line jsonb;
  pid uuid;
  cid uuid;
  ls numeric;
begin
  if p_coupon.target = 'all' then
    for line in select * from jsonb_array_elements(p_lines) loop
      eligible := eligible + (line->>'line_subtotal')::numeric;
    end loop;
    return eligible;
  end if;

  for line in select * from jsonb_array_elements(p_lines) loop
    pid := (line->>'product_id')::uuid;
    cid := nullif(line->>'category_id', '')::uuid;
    ls  := (line->>'line_subtotal')::numeric;

    if p_coupon.target = 'category' then
      if exists (
        select 1 from coupon_categories cc
        where cc.coupon_id = p_coupon.id and cc.category_id = cid
      ) then
        eligible := eligible + ls;
      end if;
    elsif p_coupon.target = 'product' then
      if exists (
        select 1 from coupon_products cp
        where cp.coupon_id = p_coupon.id and cp.product_id = pid
      ) then
        eligible := eligible + ls;
      end if;
    end if;
  end loop;

  return eligible;
end;
$$;

-- Drop the old overload first to avoid signature conflicts.
drop function if exists validate_coupon(uuid, uuid, text, numeric, jsonb);

create or replace function validate_coupon(
  p_restaurant_id uuid,
  p_customer_id   uuid,
  p_code          text,
  p_subtotal      numeric,
  p_lines         jsonb
)
returns table (
  valid       boolean,
  message     text,
  discount    numeric,
  coupon_id   uuid,
  coupon_code text          -- renamed from "code" to avoid ambiguity with c.code
)
language plpgsql
stable
as $$
declare
  c           coupons;
  eligible    numeric;
  raw_disc    numeric;
  user_uses   integer;
begin
  select * into c
  from coupons
  where restaurant_id = p_restaurant_id
    and coupons.code = p_code        -- explicit table prefix avoids ambiguity
  limit 1;

  if not found then
    return query select false, 'Invalid coupon code.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if not c.is_active then
    return query select false, 'This coupon is no longer active.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if now() < c.starts_at then
    return query select false, 'This coupon is not active yet.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if c.expires_at is not null and now() > c.expires_at then
    return query select false, 'This coupon has expired.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if p_subtotal < c.min_order_value then
    return query select false,
      'Minimum order value is Rs ' || trim(to_char(c.min_order_value, 'FM999999990.00')) || '.',
      0::numeric, null::uuid, null::text;
    return;
  end if;

  if c.usage_limit is not null and c.used_count >= c.usage_limit then
    return query select false, 'This coupon has reached its usage limit.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if c.per_user_limit is not null then
    select count(*) into user_uses
    from coupon_usages
    where coupon_usages.coupon_id = c.id
      and coupon_usages.customer_id = p_customer_id;
    if user_uses >= c.per_user_limit then
      return query select false, 'You have already used this coupon.', 0::numeric, null::uuid, null::text;
      return;
    end if;
  end if;

  eligible := coupon_eligible_subtotal(c, p_lines);
  if eligible <= 0 then
    return query select false, 'This coupon is not valid for the selected items.', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if c.discount_type = 'percentage' then
    raw_disc := round(eligible * c.discount_value / 100.0, 2);
    if c.max_discount is not null and raw_disc > c.max_discount then
      raw_disc := c.max_discount;
    end if;
  else
    raw_disc := c.discount_value;
  end if;

  if raw_disc > eligible then
    raw_disc := eligible;
  end if;

  -- Use (c.code)::text to be 100% explicit — no ambiguity with column vs variable.
  return query select true, 'Coupon applied.', round(raw_disc, 2), c.id, (c.code)::text;
end;
$$;

-- ============================================================
-- Also re-create place_order to use the renamed column
-- `coupon_code` from validate_coupon.
-- ============================================================

create or replace function place_order(
  p_customer_id     uuid,
  p_restaurant_id   uuid,
  p_items           jsonb,
  p_coupon_code     text,
  p_notes           text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof          profiles;
  settings      restaurant_settings;
  item          jsonb;
  pid           uuid;
  qty           integer;
  prod          products;
  subtotal      numeric := 0;
  line_subtotal numeric;
  lines         jsonb := '[]'::jsonb;
  cpn_valid     boolean := false;
  cpn_message   text;
  cpn_discount  numeric := 0;
  cpn_coupon_id uuid := null;
  cpn_code      text := null;
  discount      numeric := 0;
  final_total   numeric := 0;
  new_order     orders;
  existing      orders;
  onum          text;
begin
  -- Idempotency
  if p_idempotency_key is not null then
    select * into existing
    from orders
    where customer_id = p_customer_id
      and idempotency_key = p_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object(
        'order_id',     existing.id,
        'order_number', existing.order_number,
        'reused',       true
      );
    end if;
  end if;

  -- Profile
  select * into prof from profiles where id = p_customer_id;
  if not found then
    raise exception 'PROFILE_MISSING' using message = 'Your profile could not be found.';
  end if;
  if not profile_is_complete(prof) then
    raise exception 'PROFILE_INCOMPLETE' using message = 'Please complete your name, phone and college before ordering.';
  end if;

  -- Restaurant open
  select * into settings from restaurant_settings where restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using message = 'Restaurant is not available.';
  end if;
  if not settings.is_open then
    raise exception 'RESTAURANT_CLOSED' using message = 'The restaurant is currently closed and not accepting orders.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using message = 'Your cart is empty.';
  end if;

  -- Build lines
  for item in select * from jsonb_array_elements(p_items) loop
    pid := (item->>'product_id')::uuid;
    qty := (item->>'quantity')::integer;
    if qty is null or qty <= 0 then
      raise exception 'INVALID_QUANTITY' using message = 'Invalid quantity for an item.';
    end if;

    select * into prod from products where id = pid and restaurant_id = p_restaurant_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using message = 'One of the products is no longer available.';
    end if;
    if not prod.is_available then
      raise exception 'PRODUCT_UNAVAILABLE' using message = prod.name || ' is currently unavailable.';
    end if;

    line_subtotal := round(prod.price * qty, 2);
    subtotal      := subtotal + line_subtotal;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id',   prod.id,
      'category_id',  prod.category_id,
      'product_name', prod.name,
      'price',        prod.price,
      'quantity',     qty,
      'line_subtotal',line_subtotal
    ));
  end loop;

  subtotal := round(subtotal, 2);

  -- Coupon — read `coupon_code` (the renamed column from validate_coupon)
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select valid, message, discount, coupon_id, coupon_code
      into cpn_valid, cpn_message, cpn_discount, cpn_coupon_id, cpn_code
    from validate_coupon(p_restaurant_id, p_customer_id, trim(p_coupon_code), subtotal, lines);
    if not coalesce(cpn_valid, false) then
      raise exception 'COUPON_INVALID' using message = coalesce(cpn_message, 'This coupon cannot be applied.');
    end if;
    discount := coalesce(cpn_discount, 0);
  end if;

  final_total := round(subtotal - discount, 2);
  if final_total < 0 then final_total := 0; end if;

  onum := next_order_number();

  insert into orders (
    order_number, restaurant_id, customer_id, customer_name, phone, college, notes,
    subtotal, discount, total, coupon_id, coupon_code,
    payment_method, payment_status, order_status, idempotency_key
  ) values (
    onum, p_restaurant_id, p_customer_id,
    prof.full_name, prof.phone, prof.college, p_notes,
    subtotal, discount, final_total,
    cpn_coupon_id, cpn_code,
    'COD', 'PENDING', 'PLACED', p_idempotency_key
  )
  returning * into new_order;

  insert into order_items (order_id, product_id, product_name, price, quantity, subtotal)
  select
    new_order.id,
    (l->>'product_id')::uuid,
    l->>'product_name',
    (l->>'price')::numeric,
    (l->>'quantity')::integer,
    (l->>'line_subtotal')::numeric
  from jsonb_array_elements(lines) as l;

  if cpn_coupon_id is not null then
    insert into coupon_usages (coupon_id, customer_id, order_id)
    values (cpn_coupon_id, p_customer_id, new_order.id);
    update coupons set used_count = used_count + 1 where id = cpn_coupon_id;
  end if;

  return jsonb_build_object(
    'order_id',     new_order.id,
    'order_number', new_order.order_number,
    'subtotal',     new_order.subtotal,
    'discount',     new_order.discount,
    'total',        new_order.total,
    'reused',       false
  );
end;
$$;
