-- ============================================================
-- Vilasa Cafe — 006_orders.sql
-- Orders, order items, coupon usages, order-number sequence.
-- ============================================================

-- Daily-resettable sequence backing for human-readable order numbers.
create table if not exists order_number_counters (
  day_key  date primary key,
  last_seq integer not null default 0
);

create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique,
  restaurant_id   uuid not null references restaurants(id) on delete restrict,
  customer_id     uuid not null references profiles(id) on delete restrict,
  -- order-time snapshots of customer info (historical accuracy)
  customer_name   text not null,
  phone           text not null,
  college         college_enum not null,
  notes           text,
  subtotal        numeric(10,2) not null check (subtotal >= 0),
  discount        numeric(10,2) not null default 0 check (discount >= 0),
  total           numeric(10,2) not null check (total >= 0),
  coupon_id       uuid references coupons(id) on delete set null,
  coupon_code     text,
  payment_method  text not null default 'COD',
  payment_status  payment_status not null default 'PENDING',
  order_status    order_status not null default 'PLACED',
  idempotency_key text,                    -- prevents duplicate submissions
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_orders_updated
  before update on orders
  for each row execute function set_updated_at();

create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_restaurant on orders(restaurant_id);
create index if not exists idx_orders_status on orders(order_status);
create index if not exists idx_orders_created on orders(created_at desc);

-- One order per (customer, idempotency_key). Partial unique so nulls are ignored.
create unique index if not exists uq_orders_idempotency
  on orders(customer_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,
  product_name        text not null,          -- snapshot
  price               numeric(10,2) not null,  -- snapshot
  quantity            integer not null check (quantity > 0),
  subtotal            numeric(10,2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_order_items_order on order_items(order_id);

create table if not exists coupon_usages (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references coupons(id) on delete cascade,
  customer_id uuid not null references profiles(id) on delete cascade,
  order_id    uuid not null references orders(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_coupon_usages_coupon on coupon_usages(coupon_id);
create index if not exists idx_coupon_usages_customer on coupon_usages(customer_id);

-- Generate a collision-safe human-readable order number: VIL-YYYYMMDD-NNNN
create or replace function next_order_number()
returns text
language plpgsql
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  seq integer;
begin
  insert into order_number_counters(day_key, last_seq)
  values (today, 1)
  on conflict (day_key)
  do update set last_seq = order_number_counters.last_seq + 1
  returning last_seq into seq;

  return 'VIL-' || to_char(today, 'YYYYMMDD') || '-' || lpad(seq::text, 4, '0');
end;
$$;
