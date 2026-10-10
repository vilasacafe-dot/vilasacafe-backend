-- ============================================================
-- Vilasa Cafe — 001_initial_schema.sql
-- Extensions, enums, restaurant + settings tables.
-- Run migrations in numeric order (001, 002, ...).
-- ============================================================

-- Extensions -------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive text (coupon codes / emails)

-- Enums ------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type college_enum as enum ('SRM UNIVERSITY AP', 'VIT AP', 'AMRITA AP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type discount_type as enum ('percentage', 'fixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type coupon_target as enum ('all', 'category', 'product');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('PLACED', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('PENDING', 'PAID');
exception when duplicate_object then null; end $$;

-- Shared updated_at trigger ----------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Restaurants ------------------------------------------------
-- Single-tenant today (Vilasa Cafe) but structured for multi later.
create table if not exists restaurants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  phone        text,
  address      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_restaurants_updated
  before update on restaurants
  for each row execute function set_updated_at();

-- Restaurant settings (open/closed status, etc.) -------------
create table if not exists restaurant_settings (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null unique references restaurants(id) on delete cascade,
  is_open        boolean not null default true,
  closed_message text not null default 'We are currently closed. Please check back later.',
  min_order_value numeric(10,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_restaurant_settings_updated
  before update on restaurant_settings
  for each row execute function set_updated_at();

create index if not exists idx_restaurant_settings_restaurant on restaurant_settings(restaurant_id);
