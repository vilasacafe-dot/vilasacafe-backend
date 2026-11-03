-- ============================================================
-- Vilasa Cafe — 017_phone_orders.sql
--
-- 1. Add TAKEAWAY to college_enum (for walk-in / counter orders).
-- 2. Add `source` column to orders ('WEB' or 'PHONE').
-- 3. Replace next_order_number() with a new format:
--       VIL + DDMMYY + 2-digit daily sequence
--    e.g.  VIL30102601  (30 Oct 2026, order 01)
--    Uses pg_advisory_xact_lock so concurrent calls are serialised
--    and never produce the same number.
-- 4. Create place_phone_order() — admin-only function that saves a
--    counter / phone order directly to the orders table without
--    requiring a completed customer profile or restaurant-open check.
--
-- Run once in the Supabase SQL editor.
-- ============================================================

-- ── 1. Extend college_enum ───────────────────────────────────────────────
ALTER TYPE college_enum ADD VALUE IF NOT EXISTS 'TAKEAWAY';

-- ── 2. Add source column ─────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'WEB';

-- ── 3. New order-number format ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_order_number()
RETURNS TEXT
LANGUAGE PLPGSQL
AS $$
DECLARE
  today    DATE    := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  seq      INTEGER;
  date_str TEXT;
BEGIN
  -- Serialise all concurrent callers — guarantees uniqueness.
  PERFORM pg_advisory_xact_lock(hashtext('vilasa_order_counter'));

  INSERT INTO order_number_counters (day_key, last_seq)
  VALUES (today, 1)
  ON CONFLICT (day_key)
  DO UPDATE SET last_seq = order_number_counters.last_seq + 1
  RETURNING last_seq INTO seq;

  -- Format: VIL + DDMMYY + zero-padded 2-digit sequence
  -- Example: VIL30102601 → 30 Oct 2026, first order of the day
  date_str := TO_CHAR(today, 'DDMMYY');
  RETURN 'VIL' || date_str || LPAD(seq::TEXT, 2, '0');
END;
$$;

-- ── 4. place_phone_order() ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION place_phone_order(
  p_admin_id        UUID,   -- admin's auth user ID (used as customer_id)
  p_restaurant_id   UUID,
  p_items           JSONB,  -- [{ product_id, quantity }]
  p_customer_name   TEXT,   -- optional walk-in name
  p_phone           TEXT,   -- optional phone number
  p_college         TEXT,   -- campus or TAKEAWAY
  p_notes           TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          JSONB;
  v_pid           UUID;
  v_qty           INTEGER;
  v_prod          products;
  v_subtotal      NUMERIC := 0;
  v_line_subtotal NUMERIC;
  v_lines         JSONB   := '[]'::JSONB;
  v_final_total   NUMERIC;
  v_new_order     orders;
  v_existing      orders;
  v_onum          TEXT;
BEGIN
  -- Idempotency: return existing order if this key was already used.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM orders
    WHERE customer_id     = p_admin_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',     v_existing.id,
        'order_number', v_existing.order_number,
        'total',        v_existing.total,
        'reused',       true
      );
    END IF;
  END IF;

  -- Validate items present.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART' USING MESSAGE = 'No items in the order.';
  END IF;

  -- Build lines from live DB prices (admin cannot manipulate prices).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::INTEGER;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING MESSAGE = 'Invalid quantity for an item.';
    END IF;

    SELECT * INTO v_prod
    FROM products
    WHERE id = v_pid AND restaurant_id = p_restaurant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND'
        USING MESSAGE = 'One of the products is no longer available.';
    END IF;

    v_line_subtotal := ROUND(v_prod.price * v_qty, 2);
    v_subtotal      := v_subtotal + v_line_subtotal;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',    v_prod.id,
      'product_name',  v_prod.name,
      'price',         v_prod.price,
      'quantity',      v_qty,
      'line_subtotal', v_line_subtotal
    ));
  END LOOP;

  v_subtotal    := ROUND(v_subtotal, 2);
  v_final_total := v_subtotal;
  v_onum        := next_order_number();

  INSERT INTO orders (
    order_number, restaurant_id, customer_id,
    customer_name, phone, college, notes,
    subtotal, discount, total,
    payment_method, payment_status, order_status,
    source, idempotency_key
  ) VALUES (
    v_onum,
    p_restaurant_id,
    p_admin_id,
    COALESCE(NULLIF(TRIM(COALESCE(p_customer_name, '')), ''), 'Walk-in Customer'),
    COALESCE(NULLIF(TRIM(COALESCE(p_phone,         '')), ''), ''),
    p_college::college_enum,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    v_subtotal, 0, v_final_total,
    'COD', 'PENDING', 'PLACED',
    'PHONE',
    p_idempotency_key
  )
  RETURNING * INTO v_new_order;

  -- Insert order items.
  INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
  SELECT
    v_new_order.id,
    (l->>'product_id')::UUID,
    l->>'product_name',
    (l->>'price')::NUMERIC,
    (l->>'quantity')::INTEGER,
    (l->>'line_subtotal')::NUMERIC
  FROM jsonb_array_elements(v_lines) AS l;

  RETURN jsonb_build_object(
    'order_id',     v_new_order.id,
    'order_number', v_new_order.order_number,
    'subtotal',     v_new_order.subtotal,
    'total',        v_new_order.total,
    'reused',       false
  );
END;
$$;
