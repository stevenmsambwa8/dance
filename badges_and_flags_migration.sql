-- ============================================================
-- Badges & Flags Migration
-- Adds country_flag, is_season_winner to profiles
-- Adds season-end reset helper for is_season_winner
-- Apply in Supabase SQL Editor
-- ============================================================

-- ── 1. Add country_flag column ──────────────────────────────
-- Stores the player's chosen flag: 'kenya' | 'tanzania' | 'uganda' | NULL
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS country_flag TEXT
  CHECK (country_flag IS NULL OR country_flag IN ('kenya', 'tanzania', 'uganda'));

-- ── 2. Add is_season_winner column ──────────────────────────
-- Set to TRUE when admin crowns a tournament champion.
-- Cleared at the start of each new season via the function below.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_season_winner BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Index for fast badge lookups ─────────────────────────
CREATE INDEX IF NOT EXISTS profiles_is_season_winner_idx
  ON profiles (is_season_winner)
  WHERE is_season_winner = TRUE;

-- ── 4. Season-reset helper ───────────────────────────────────
-- Call this at the start of every new season (every 2 months)
-- to strip the fire badge from last season's winners.
-- You can trigger this manually from the Admin panel or via
-- a Supabase scheduled Edge Function.
CREATE OR REPLACE FUNCTION reset_season_winners()
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET is_season_winner = FALSE
  WHERE is_season_winner = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 5. RLS — allow authenticated users to read the new columns ──
-- The existing SELECT policy on profiles should cover these
-- automatically. If you have a restrictive column-level policy, run:
-- GRANT SELECT (country_flag, is_season_winner) ON profiles TO authenticated, anon;
-- GRANT UPDATE (country_flag) ON profiles TO authenticated;

-- ── 6. Backfill existing rows ────────────────────────────────
-- Ensure all existing profiles have the default values set
-- (handles rows created before this migration).
UPDATE profiles
  SET country_flag    = NULL,
      is_season_winner = FALSE
  WHERE country_flag IS NULL
    AND is_season_winner IS NULL;

-- ── Done ─────────────────────────────────────────────────────
-- After applying this migration:
--   • Users can pick kenya / tanzania / uganda on signup and in Edit Profile
--   • Tournament champions automatically get is_season_winner = TRUE
--     when an admin crowns them in the bracket
--   • Run SELECT reset_season_winners(); at the start of each new season
