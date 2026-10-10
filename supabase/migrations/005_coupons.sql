-- ============================================================
-- Vilasa Cafe — 005_coupons.sql
-- Coupons + targeting (categories / products) + usage tracking.
-- ============================================================

create table if not exists coupons (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  code               citext not null,
  description        text,
  discount_type      discount_type not null,
  discount_value     numeric(10,2) not null check (discount_value > 0),
  min_order_value    numeric(10,2) not null default 0 check (min_order_value >= 0),
  max_discount       numeric(10,2) check (max_discount is null or max_discount > 0),
  target             coupon_target not null default 'all',
  starts_at          timestamptz not null default now(),
  expires_at         timestamptz,
  is_active          boolean not null default true,
  usage_limit        integer check (usage_limit is null or usage_limit > 0),
  per_user_limit     integer check (per_user_limit is null or per_user_limit > 0),
  used_count         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, code),
  -- percentage values must be within 0-100
  constraint chk_percentage_range check (
    discount_type <> 'percentage' or (discount_value > 0 and discount_value <= 100)
  ),
  constraint chk_valid_window check (expires_at is null or expires_at > starts_at)
);

create trigger trg_coupons_updated
  before update on coupons
  for each row execute function set_updated_at();

create index if not exists idx_coupons_restaurant on coupons(restaurant_id);
create index if not exists idx_coupons_active on coupons(is_active);
create index if not exists idx_coupons_code on coupons(code);

-- Coupon → category links (for target = 'category')
create table if not exists coupon_categories (
  coupon_id   uuid not null references coupons(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (coupon_id, category_id)
);

-- Coupon → product links (for target = 'product')
create table if not exists coupon_products (
  coupon_id  uuid not null references coupons(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  primary key (coupon_id, product_id)
);

create index if not exists idx_coupon_categories_coupon on coupon_categories(coupon_id);
create index if not exists idx_coupon_products_coupon on coupon_products(coupon_id);
