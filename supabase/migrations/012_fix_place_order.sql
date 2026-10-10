-- ============================================================
-- Vilasa Cafe — 012_fix_place_order.sql
-- Fix: "column reference discount is ambiguous" when placing an
-- order with a coupon. place_order declared a local variable named
-- `discount`, which collided with the `discount` column returned by
-- validate_coupon in the SELECT ... INTO. Renamed the local variable
-- to `v_discount` (and all related locals to v_*) to remove ambiguity.
--
-- Safe to run on top of 007 + 011. Just run this whole file once in
-- the Supabase SQL editor.
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
  v_prof          profiles;
  v_settings      restaurant_settings;
  v_item          jsonb;
  v_pid           uuid;
  v_qty           integer;
  v_prod          products;
  v_subtotal      numeric := 0;
  v_line_subtotal numeric;
  v_lines         jsonb := '[]'::jsonb;
  v_cpn_valid     boolean := false;
  v_cpn_message   text;
  v_cpn_discount  numeric := 0;
  v_cpn_coupon_id uuid := null;
  v_cpn_code      text := null;
  v_discount      numeric := 0;
  v_final_total   numeric := 0;
  v_new_order     orders;
  v_existing      orders;
  v_onum          text;
begin
  -- Idempotency: return the already-created order if this key was used.
  if p_idempotency_key is not null then
    select * into v_existing
    from orders
    where customer_id = p_customer_id
      and idempotency_key = p_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object(
        'order_id',     v_existing.id,
        'order_number', v_existing.order_number,
        'reused',       true
      );
    end if;
  end if;

  -- Profile checks
  select * into v_prof from profiles where id = p_customer_id;
  if not found then
    raise exception 'PROFILE_MISSING' using message = 'Your profile could not be found.';
  end if;
  if not profile_is_complete(v_prof) then
    raise exception 'PROFILE_INCOMPLETE' using message = 'Please complete your name, phone and college before ordering.';
  end if;

  -- Restaurant open check (server-authoritative)
  select * into v_settings from restaurant_settings where restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND' using message = 'Restaurant is not available.';
  end if;
  if not v_settings.is_open then
    raise exception 'RESTAURANT_CLOSED' using message = 'The restaurant is currently closed and not accepting orders.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using message = 'Your cart is empty.';
  end if;

  -- Build lines from DB prices
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QUANTITY' using message = 'Invalid quantity for an item.';
    end if;

    select * into v_prod from products where id = v_pid and restaurant_id = p_restaurant_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using message = 'One of the products is no longer available.';
    end if;
    if not v_prod.is_available then
      raise exception 'PRODUCT_UNAVAILABLE' using message = v_prod.name || ' is currently unavailable.';
    end if;

    v_line_subtotal := round(v_prod.price * v_qty, 2);
    v_subtotal      := v_subtotal + v_line_subtotal;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',    v_prod.id,
      'category_id',   v_prod.category_id,
      'product_name',  v_prod.name,
      'price',         v_prod.price,
      'quantity',      v_qty,
      'line_subtotal', v_line_subtotal
    ));
  end loop;

  v_subtotal := round(v_subtotal, 2);

  -- Coupon (read the renamed `coupon_code` column from validate_coupon)
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select vc.valid, vc.message, vc.discount, vc.coupon_id, vc.coupon_code
      into v_cpn_valid, v_cpn_message, v_cpn_discount, v_cpn_coupon_id, v_cpn_code
    from validate_coupon(p_restaurant_id, p_customer_id, trim(p_coupon_code), v_subtotal, v_lines) as vc;

    if not coalesce(v_cpn_valid, false) then
      raise exception 'COUPON_INVALID' using message = coalesce(v_cpn_message, 'This coupon cannot be applied.');
    end if;
    v_discount := coalesce(v_cpn_discount, 0);
  end if;

  v_final_total := round(v_subtotal - v_discount, 2);
  if v_final_total < 0 then v_final_total := 0; end if;

  v_onum := next_order_number();

  insert into orders (
    order_number, restaurant_id, customer_id, customer_name, phone, college, notes,
    subtotal, discount, total, coupon_id, coupon_code,
    payment_method, payment_status, order_status, idempotency_key
  ) values (
    v_onum, p_restaurant_id, p_customer_id,
    v_prof.full_name, v_prof.phone, v_prof.college, p_notes,
    v_subtotal, v_discount, v_final_total,
    v_cpn_coupon_id, v_cpn_code,
    'COD', 'PENDING', 'PLACED', p_idempotency_key
  )
  returning * into v_new_order;

  insert into order_items (order_id, product_id, product_name, price, quantity, subtotal)
  select
    v_new_order.id,
    (l->>'product_id')::uuid,
    l->>'product_name',
    (l->>'price')::numeric,
    (l->>'quantity')::integer,
    (l->>'line_subtotal')::numeric
  from jsonb_array_elements(v_lines) as l;

  if v_cpn_coupon_id is not null then
    insert into coupon_usages (coupon_id, customer_id, order_id)
    values (v_cpn_coupon_id, p_customer_id, v_new_order.id);
    update coupons set used_count = used_count + 1 where id = v_cpn_coupon_id;
  end if;

  return jsonb_build_object(
    'order_id',     v_new_order.id,
    'order_number', v_new_order.order_number,
    'subtotal',     v_new_order.subtotal,
    'discount',     v_new_order.discount,
    'total',        v_new_order.total,
    'reused',       false
  );
end;
$$;
