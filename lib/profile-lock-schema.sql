-- ============================================================================
-- Nabogaming — 60-day identity field lock (username, profile picture, flag)
-- Run this once in Supabase Dashboard → SQL Editor.
-- Mirrors the conventions of events-schema.sql / referral-schema.sql.
--
-- This is the enforcement layer: it blocks the update at the database level
-- no matter which client path sends it (Settings page, admin dashboard,
-- direct API calls). lib/profileLock.js + AuthProvider.updateProfile give the
-- same 60-day check in the app for a fast, friendly error before we even hit
-- the network — this trigger is the backstop that can't be bypassed.
-- ============================================================================

alter table public.profiles
  add column if not exists username_changed_at     timestamptz,
  add column if not exists avatar_changed_at        timestamptz,
  add column if not exists country_flag_changed_at  timestamptz;

create or replace function public.profiles_enforce_change_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cooldown     interval := interval '60 days';
  -- A user editing their own row is subject to the cooldown. An admin (or
  -- any other actor with permission to update someone else's row) is not —
  -- they're a different auth.uid() than the profile being edited.
  is_self_edit boolean  := auth.uid() is not null and auth.uid() = old.id;
  days_left    int;
begin
  if is_self_edit and new.username is distinct from old.username then
    if old.username_changed_at is not null and now() - old.username_changed_at < cooldown then
      days_left := ceil(extract(epoch from ((old.username_changed_at + cooldown) - now())) / 86400);
      raise exception 'Username is locked for % more day(s). It can only be changed once every 60 days.', days_left;
    end if;
    new.username_changed_at := now();
  end if;

  if is_self_edit and new.country_flag is distinct from old.country_flag then
    if old.country_flag_changed_at is not null and now() - old.country_flag_changed_at < cooldown then
      days_left := ceil(extract(epoch from ((old.country_flag_changed_at + cooldown) - now())) / 86400);
      raise exception 'Country flag is locked for % more day(s). It can only be changed once every 60 days.', days_left;
    end if;
    new.country_flag_changed_at := now();
  end if;

  if is_self_edit and new.avatar_url is distinct from old.avatar_url then
    if old.avatar_changed_at is not null and now() - old.avatar_changed_at < cooldown then
      days_left := ceil(extract(epoch from ((old.avatar_changed_at + cooldown) - now())) / 86400);
      raise exception 'Profile picture is locked for % more day(s). It can only be changed once every 60 days.', days_left;
    end if;
    new.avatar_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_change_cooldown on public.profiles;
create trigger profiles_change_cooldown
  before update on public.profiles
  for each row execute function public.profiles_enforce_change_cooldown();
