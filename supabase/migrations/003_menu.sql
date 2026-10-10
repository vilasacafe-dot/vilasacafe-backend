-- ============================================================
-- Vilasa Cafe — 003_menu.sql
-- Categories and products.
-- ============================================================

create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  slug          text not null,
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, slug)
);

create trigger trg_categories_updated
  before update on categories
  for each row execute function set_updated_at();

create index if not exists idx_categories_restaurant on categories(restaurant_id);
create index if not exists idx_categories_active on categories(is_active);
create index if not exists idx_categories_order on categories(display_order);

create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  category_id    uuid references categories(id) on delete set null,
  name           text not null,
  description    text,
  price          numeric(10,2) not null check (price >= 0),
  image_key      text,                         -- R2 object key
  image_url      text,                         -- public URL
  is_available   boolean not null default true,
  is_featured    boolean not null default false,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_products_updated
  before update on products
  for each row execute function set_updated_at();

create index if not exists idx_products_restaurant on products(restaurant_id);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_available on products(is_available);
create index if not exists idx_products_featured on products(is_featured);
create index if not exists idx_products_order on products(display_order);
