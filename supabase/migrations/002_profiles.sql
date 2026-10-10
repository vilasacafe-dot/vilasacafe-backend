-- ============================================================
-- Vilasa Cafe — 002_profiles.sql
-- Customer/admin profiles linked to auth.users.
-- ============================================================

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  email        citext,
  phone        text,                         -- 10-digit Indian mobile, validated app + db side
  college      college_enum,
  role         user_role not null default 'customer',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 10-digit Indian mobile: starts 6-9, exactly 10 digits (nullable until completed)
  constraint chk_phone_format check (phone is null or phone ~ '^[6-9][0-9]{9}$')
);

create trigger trg_profiles_updated
  before update on profiles
  for each row execute function set_updated_at();

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_phone on profiles(phone);

-- A profile is "complete" for checkout when name, phone, college are all present.
create or replace function profile_is_complete(p profiles)
returns boolean
language sql
immutable
as $$
  select p.full_name is not null
     and length(trim(p.full_name)) > 0
     and p.phone is not null
     and p.college is not null;
$$;

-- Auto-create a profile row when a new auth user signs up (Google OAuth).
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
