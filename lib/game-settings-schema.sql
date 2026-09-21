-- ============================================================================
-- Nabogaming — per-game visibility / availability controls (admin "Games" tab)
-- Run this once in Supabase Dashboard → SQL Editor.
--
-- status:
--   'active'   (or no row)  → game is live
--   'hidden'                → hidden everywhere on the website (reversible)
--   'disabled'              → visible but unavailable until disabled_until,
--                             then it re-enables itself automatically
--   'deleted'               → removed forever (cannot be restored from the UI)
--
-- Everyone can READ this table (the site needs it to know what to show).
-- Nobody can write to it from the browser: there are deliberately no
-- insert/update/delete policies, so only the admin API route
-- (app/api/admin/games/route.js, service-role key) can change it.
-- ============================================================================

create table if not exists public.game_settings (
  slug           text primary key,
  status         text not null default 'active'
                   check (status in ('active', 'hidden', 'disabled', 'deleted')),
  disabled_until timestamptz,
  note           text,
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);

alter table public.game_settings enable row level security;

drop policy if exists "game_settings_read" on public.game_settings;
create policy "game_settings_read" on public.game_settings
  for select using (true);
