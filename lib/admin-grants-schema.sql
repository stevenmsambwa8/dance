-- ============================================================================
-- Nabogaming — temporary admin grants + user-editable badges
-- Run this once in Supabase Dashboard → SQL Editor.
-- Mirrors the conventions of profile-lock-schema.sql: the app does the
-- friendly-UX check, this trigger is the backstop that can't be bypassed
-- by a direct client-side update to a user's own profiles row.
-- ============================================================================

alter table public.profiles
  add column if not exists temp_admin_until timestamptz;

-- custom_badges is expected to already exist as jsonb (used by
-- components/UserBadges.js). Each badge object may carry:
--   { id, label, icon, iconUrl, color, desc, editable }
-- `editable: true` means the admin who added it has allowed the badge's
-- owner to edit its label/icon/color/desc themselves. `editable` and `id`
-- can only be set by an admin — never by the user editing their own row.
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
  old_badges   jsonb   := coalesce(old.custom_badges, '[]'::jsonb);
  new_badges   jsonb   := coalesce(new.custom_badges, '[]'::jsonb);
  old_ids      text[];
  new_ids      text[];
  old_b        jsonb;
  new_b        jsonb;
  i            int;
begin
  -- Temporary admin status can never be granted, extended, or cleared by
  -- the row's own owner — only the admin dashboard route can touch it.
  if is_self_edit and new.temp_admin_until is distinct from old.temp_admin_until then
    raise exception 'temp_admin_until cannot be self-modified';
  end if;

  if is_self_edit and new_badges is distinct from old_badges then
    if jsonb_array_length(new_badges) <> jsonb_array_length(old_badges) then
      raise exception 'Badges can only be added or removed by an admin';
    end if;

    select array_agg(b->>'id') into old_ids from jsonb_array_elements(old_badges) b;
    select array_agg(b->>'id') into new_ids from jsonb_array_elements(new_badges) b;
    if old_ids is distinct from new_ids then
      raise exception 'Badges can only be added, removed, or reordered by an admin';
    end if;

    for i in 0 .. jsonb_array_length(old_badges) - 1 loop
      old_b := old_badges -> i;
      new_b := new_badges -> i;
      if coalesce((old_b->>'editable')::boolean, false) is false then
        if old_b is distinct from new_b then
          raise exception 'This badge is not editable by its owner';
        end if;
      else
        if coalesce((old_b->>'editable')::boolean, false)
           is distinct from coalesce((new_b->>'editable')::boolean, false) then
          raise exception 'Cannot change a badge''s editable flag';
        end if;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_privileged_fields on public.profiles;
create trigger profiles_privileged_fields
  before update on public.profiles
  for each row execute function public.profiles_enforce_privileged_fields();
