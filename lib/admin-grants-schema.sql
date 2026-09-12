-- ============================================================================
-- Nabogaming — temporary admin grants + admin-only badge enforcement
-- Run this once in Supabase Dashboard → SQL Editor.
-- Mirrors the conventions of profile-lock-schema.sql: the app does the
-- friendly-UX check, this trigger is the backstop that can't be bypassed
-- by a direct client-side update to a user's own profiles row.
-- ============================================================================

alter table public.profiles
  add column if not exists temp_admin_until timestamptz;

-- custom_badges is expected to already exist as jsonb (used by
-- components/UserBadges.js). Each badge object carries:
--   { id, label, icon, iconUrl, color, desc }
-- Badges are admin-only, full stop: only the admin dashboard route (which
-- runs with the service-role key, so auth.uid() is null) may add, remove,
-- or edit a user's badges. A user can never change their own badges,
-- including badges that were added to their own profile — not even a
-- single field of one.
alter table public.profiles
  add column if not exists custom_badges jsonb not null default '[]'::jsonb;

create or replace function public.profiles_enforce_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A user editing their own row via the client SDK. Admin dashboard writes
  -- go through the service-role key (no session → auth.uid() is null), so
  -- this is false for those and true only for a self-service update.
  is_self_edit boolean := auth.uid() is not null and auth.uid() = old.id;
begin
  -- Temporary admin status can never be granted, extended, or cleared by
  -- the row's own owner — only the admin dashboard route can touch it.
  if is_self_edit and new.temp_admin_until is distinct from old.temp_admin_until then
    raise exception 'temp_admin_until cannot be self-modified';
  end if;

  -- Badges: admin-only. A user's own session can never change this column,
  -- even to edit a badge already sitting on their own profile.
  if is_self_edit and coalesce(new.custom_badges, '[]'::jsonb) is distinct from coalesce(old.custom_badges, '[]'::jsonb) then
    raise exception 'Badges can only be added, removed, or edited by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_privileged_fields on public.profiles;
create trigger profiles_privileged_fields
  before update on public.profiles
  for each row execute function public.profiles_enforce_privileged_fields();
