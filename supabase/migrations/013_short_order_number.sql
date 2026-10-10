-- ============================================================
-- Vilasa Cafe — 013_short_order_number.sql
-- Change order number format from VIL-YYYYMMDD-NNNN
-- to VIL + 3-digit daily sequence, e.g. VIL001, VIL042.
-- Re-run safe: replaces the function only, no data migration needed
-- (existing orders keep their existing order_number values).
-- ============================================================

create or replace function next_order_number()
returns text
language plpgsql
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  seq   integer;
begin
  insert into order_number_counters(day_key, last_seq)
  values (today, 1)
  on conflict (day_key)
  do update set last_seq = order_number_counters.last_seq + 1
  returning last_seq into seq;

  -- Format: VIL + zero-padded 3-digit sequence, e.g. VIL001 … VIL999
  return 'VIL' || lpad(seq::text, 3, '0');
end;
$$;
