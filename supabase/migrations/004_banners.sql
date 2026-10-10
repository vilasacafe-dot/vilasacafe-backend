-- ============================================================
-- Vilasa Cafe — 004_banners.sql
-- Homepage hero banners (max 3 active enforced by trigger).
-- ============================================================

create table if not exists hero_banners (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  title          text,
  image_key      text not null,
  image_url      text not null,
  link_url       text,
  is_active      boolean not null default true,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_hero_banners_updated
  before update on hero_banners
  for each row execute function set_updated_at();

create index if not exists idx_banners_restaurant on hero_banners(restaurant_id);
create index if not exists idx_banners_active on hero_banners(is_active);
create index if not exists idx_banners_order on hero_banners(display_order);

-- Enforce a maximum of 3 ACTIVE banners per restaurant.
create or replace function enforce_max_active_banners()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if new.is_active then
    select count(*) into active_count
    from hero_banners
    where restaurant_id = new.restaurant_id
      and is_active = true
      and id <> new.id;
    if active_count >= 3 then
      raise exception 'Maximum of 3 active banners allowed'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_max_active_banners on hero_banners;
create trigger trg_max_active_banners
  before insert or update on hero_banners
  for each row execute function enforce_max_active_banners();
