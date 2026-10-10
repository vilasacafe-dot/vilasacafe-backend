-- ============================================================
-- Vilasa Cafe — 009_realtime.sql
-- Enable Supabase Realtime for order flow.
--
-- Customers subscribe to their own orders (status changes).
-- Admin subscribes to all orders (new orders + status).
-- RLS still applies to realtime, so filters remain secure.
-- ============================================================

-- Ensure full row data is emitted on UPDATE (needed for status diffs).
alter table orders replica identity full;
alter table order_items replica identity full;

-- Add tables to the realtime publication (idempotent guards).
do $$
begin
  begin
    alter publication supabase_realtime add table orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table order_items;
  exception when duplicate_object then null;
  end;
end $$;
