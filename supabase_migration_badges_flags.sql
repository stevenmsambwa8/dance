-- Run this once in the Supabase SQL editor before using the new
-- dashboard controls (missing-flag fix + custom winner badges).

-- 1. New column to store admin-assigned custom badges per player.
--    Shape of each array entry: { "id": "...", "label": "...", "icon": "🏅", "color": "#f97316", "desc": "..." }
alter table profiles
  add column if not exists custom_badges jsonb not null default '[]'::jsonb;

-- 2. One-time backfill: give everyone who currently has no flag the
--    Tanzania default. (The dashboard's "Fix Missing Flags" button does
--    this same thing on demand, so this step is optional/idempotent —
--    safe to run again later.)
update profiles
  set country_flag = 'tanzania'
  where country_flag is null;

-- 3. Tag every player who has ever entered an eFootball tournament with
--    the "eFootball" game tag (matches the exact string used by the
--    Settings/Account game-tag pickers). Safe to re-run — it only adds
--    the tag if it isn't already present, and never removes existing tags.
update profiles p
set game_tags = array_append(coalesce(p.game_tags, '{}'), 'eFootball')
where p.id in (
  select distinct tp.user_id
  from tournament_participants tp
  join tournaments t on t.id = tp.tournament_id
  where t.game_slug = 'efootball'
)
and not ('eFootball' = any(coalesce(p.game_tags, '{}')));
