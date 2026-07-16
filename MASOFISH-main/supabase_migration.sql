-- ============================================================================
-- MASOFISH — Supabase Migration
-- Sets up: public.profiles table, an auto-provisioning trigger on
-- auth.users, and Row Level Security (RLS) policies.
--
-- Safe to paste directly into the Supabase SQL Editor and run top to bottom.
-- Every statement uses IF EXISTS / OR REPLACE / DROP-then-CREATE guards so
-- this script can be re-run without erroring on objects that already exist.
-- ============================================================================


-- ============================================================================
-- 1. PROFILES TABLE
-- ----------------------------------------------------------------------------
-- One row per Supabase Auth user. `id` is both the primary key and a
-- foreign key into auth.users, so deleting an auth user cascades and
-- automatically removes their profile too.
-- ============================================================================

create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  updated_at     timestamp with time zone not null default now(),
  full_name      text,
  location       text,
  favorite_fish  text,
  role           text not null default 'user'
                 constraint profiles_role_check check (role in ('user', 'admin'))
);

comment on table public.profiles is 'Public-facing profile data for each MASOFISH user, one row per auth.users record.';
comment on column public.profiles.id is 'References auth.users.id — the profile is deleted automatically if the auth user is deleted.';
comment on column public.profiles.role is 'Access role. Restricted to ''user'' or ''admin'' via CHECK constraint; defaults to ''user''.';


-- ============================================================================
-- 2. AUTOMATED PROFILE CREATION ON SIGN-UP
-- ----------------------------------------------------------------------------
-- Whenever a new row is inserted into auth.users (i.e. someone signs up),
-- automatically create a matching public.profiles row. The function runs
-- with SECURITY DEFINER so it can write to public.profiles regardless of
-- the RLS policies below (which otherwise restrict inserts to the user
-- themselves — but at signup time no session/JWT exists yet).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    -- Prefer the full_name passed in at signup (auth.signUp({ options: { data: { full_name } } })).
    -- Fall back to a "name" key some OAuth providers use, then to the email
    -- local-part, then to a generic label so full_name is never left null.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      'MASOFISH Angler'
    )
  )
  -- If a client-side upsert (see auth.html) already created the row for
  -- this user, do nothing rather than raising a duplicate-key error.
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is 'Auto-creates a public.profiles row for every new auth.users record, seeding full_name from signup metadata.';

-- Bind the function to run after every insert on auth.users.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();


-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
-- RLS is enabled so the database itself enforces who can read/write which
-- rows, independent of what the client-side JS does or doesn't check.
-- ============================================================================

alter table public.profiles enable row level security;

-- --- READ ---------------------------------------------------------------
-- MASOFISH is a social/community site (catch logs, shared recipes, angler
-- names visible to each other), so profiles are readable by any
-- authenticated user rather than fully public/anonymous. This still keeps
-- profile data out of reach of unauthenticated scrapers while letting the
-- whole community browse each other's profiles once logged in.
drop policy if exists "Authenticated users can view all profiles" on public.profiles;

create policy "Authenticated users can view all profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- --- UPDATE (self) --------------------------------------------------------
-- A user may only update their own profile row.
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- --- UPDATE (admin override) ----------------------------------------------
-- Users whose own profile has role = 'admin' may update any profile
-- (e.g. moderating names or adjusting another user's role).
drop policy if exists "Admins can update any profile" on public.profiles;

create policy "Admins can update any profile"
  on public.profiles
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles admin_check
      where admin_check.id = auth.uid()
        and admin_check.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles admin_check
      where admin_check.id = auth.uid()
        and admin_check.role = 'admin'
    )
  );

-- --- INSERT ----------------------------------------------------------------
-- Normal signups are handled by the SECURITY DEFINER trigger above, which
-- bypasses RLS entirely. This policy exists only as a safety net for the
-- client-side upsert fallback in auth.html, so a logged-in user can insert
-- their own row (and only their own) if the trigger hasn't fired yet.
drop policy if exists "Users can insert their own profile" on public.profiles;

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);


-- ============================================================================
-- Done. Verify in the Table Editor: public.profiles should exist with RLS
-- enabled (a small "RLS" badge on the table), and Database → Triggers
-- should list "on_auth_user_created" on auth.users.
-- ============================================================================
