-- ============================================================
-- Vilasa Cafe — 015_fix_order_number.sql
--
-- Fix: "duplicate key value violates unique constraint
--       orders_order_number_key"
--
-- Root cause:
--   013_short_order_number.sql generates VIL001, VIL002 …
--   but resets the counter back to 1 every new calendar day.
--   On day 2, VIL001 is produced again and collides with the
--   VIL001 row already sitting in the orders table.
--
-- Fix:
--   Replace the daily-reset counter with a global PostgreSQL
--   SEQUENCE. nextval() is strictly atomic (Postgres guarantees
--   it at the storage level) and NEVER produces the same value
--   twice, even under the highest concurrency.
--   Order numbers simply continue from the current maximum so
--   existing orders are completely unaffected.
--
-- Run once in the Supabase SQL editor.
-- ============================================================

-- Step 1 — create the global sequence (no-op if it already exists).
CREATE SEQUENCE IF NOT EXISTS global_order_number_seq START 1;

-- Step 2 — advance the sequence past any VILxxx orders already in
--           the database so we never reuse an existing number.
DO $$
DECLARE
  v_max INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN order_number ~ '^VIL[0-9]+$'
        THEN SUBSTRING(order_number FROM 4)::INTEGER
        ELSE 0
      END
    ), 0
  ) INTO v_max
  FROM orders;

  IF v_max > 0 THEN
    -- setval(seq, n) makes the NEXT nextval() call return n+1.
    PERFORM setval('global_order_number_seq', v_max);
  END IF;
END;
$$;

-- Step 3 — replace next_order_number() with a sequence-backed version.
--   • No daily reset — numbers go up monotonically forever.
--   • nextval() is atomic: concurrent calls always get distinct values.
CREATE OR REPLACE FUNCTION next_order_number()
RETURNS TEXT
LANGUAGE SQL
AS $$
  SELECT 'VIL' || LPAD(nextval('global_order_number_seq')::TEXT, 3, '0');
$$;
