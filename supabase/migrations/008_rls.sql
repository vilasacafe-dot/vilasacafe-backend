-- ============================================================
-- Vilasa Cafe — 008_rls.sql
-- Row Level Security. Backend privileged work uses the service
-- role (bypasses RLS). These policies protect the anon/auth
-- client used by browsers + realtime subscriptions.
-- ============================================================

-- Helper: is the current auth user an admin?
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Enable RLS ------------------------------------------------
alter table restaurants          enable row level security;
alter table restaurant_settings  enable row level security;
alter table profiles             enable row level security;
alter table categories           enable row level security;
alter table products             enable row level security;
alter table hero_banners         enable row level security;
alter table coupons              enable row level security;
alter table coupon_categories    enable row level security;
alter table coupon_products      enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table coupon_usages        enable row level security;

-- Restaurants: public read, admin write ---------------------
drop policy if exists restaurants_read on restaurants;
create policy restaurants_read on restaurants
  for select using (true);

drop policy if exists restaurants_admin_write on restaurants;
create policy restaurants_admin_write on restaurants
  for all using (is_admin()) with check (is_admin());

-- Restaurant settings: public read, admin write ------------
drop policy if exists settings_read on restaurant_settings;
create policy settings_read on restaurant_settings
  for select using (true);

drop policy if exists settings_admin_write on restaurant_settings;
create policy settings_admin_write on restaurant_settings
  for all using (is_admin()) with check (is_admin());

-- Profiles --------------------------------------------------
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (auth.uid() = id or is_admin());

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- Note: role escalation is prevented because customers cannot set role
-- via this policy path unless they already are admin; enforce in app too.

-- Categories: public read, admin write ----------------------
drop policy if exists categories_read on categories;
create policy categories_read on categories
  for select using (true);

drop policy if exists categories_admin_write on categories;
create policy categories_admin_write on categories
  for all using (is_admin()) with check (is_admin());

-- Products: public read, admin write ------------------------
drop policy if exists products_read on products;
create policy products_read on products
  for select using (true);

drop policy if exists products_admin_write on products;
create policy products_admin_write on products
  for all using (is_admin()) with check (is_admin());

-- Hero banners: public read, admin write --------------------
drop policy if exists banners_read on hero_banners;
create policy banners_read on hero_banners
  for select using (true);

drop policy if exists banners_admin_write on hero_banners;
create policy banners_admin_write on hero_banners
  for all using (is_admin()) with check (is_admin());

-- Coupons: admin only (validation happens server-side) ------
drop policy if exists coupons_admin_all on coupons;
create policy coupons_admin_all on coupons
  for all using (is_admin()) with check (is_admin());

drop policy if exists coupon_categories_admin_all on coupon_categories;
create policy coupon_categories_admin_all on coupon_categories
  for all using (is_admin()) with check (is_admin());

drop policy if exists coupon_products_admin_all on coupon_products;
create policy coupon_products_admin_all on coupon_products
  for all using (is_admin()) with check (is_admin());

-- Orders: customer reads own, admin reads/updates all -------
drop policy if exists orders_select on orders;
create policy orders_select on orders
  for select using (auth.uid() = customer_id or is_admin());

drop policy if exists orders_admin_update on orders;
create policy orders_admin_update on orders
  for update using (is_admin()) with check (is_admin());
-- Inserts are performed by the backend (service role / SECURITY DEFINER),
-- so no INSERT policy is granted to browser clients.

-- Order items: readable if the parent order is readable -----
drop policy if exists order_items_select on order_items;
create policy order_items_select on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (o.customer_id = auth.uid() or is_admin())
    )
  );

-- Coupon usages: customer own, admin all --------------------
drop policy if exists coupon_usages_select on coupon_usages;
create policy coupon_usages_select on coupon_usages
  for select using (customer_id = auth.uid() or is_admin());

-- Prevent privilege escalation ------------------------------
-- The profiles_update_own policy lets a user edit their own row. Without
-- this guard a customer could set role='admin' via the REST API. We coerce
-- the role for any change attempted by a normal signed-in user. Server-side
-- contexts (service role / SQL editor) have a null auth.uid() and existing
-- admins are allowed, so the admin bootstrap in 010_seed still works.
create or replace function guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_admin() then
    if tg_op = 'INSERT' then
      new.role := 'customer';
    elsif new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_role on profiles;
create trigger trg_guard_profile_role
  before insert or update on profiles
  for each row execute function guard_profile_role();
