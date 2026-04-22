-- ============================================================
-- nabogaming — Season System Migration
-- Apply in Supabase SQL Editor (safe to run multiple times)
-- Seasons start at 1 (Jan–Feb 2024), increment every 2 months.
-- ============================================================

-- ── 1. Add season columns to profiles ────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS current_season   INT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS season_wins      INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS season_losses    INT     NOT NULL DEFAULT 0;

-- Backfill existing rows to the current season (Season 10 = Apr–May 2025, Season 12 = Mar-Apr 2026 etc.)
-- Formula: CEIL(months_since_2024-01-01 / 2) + 1
UPDATE profiles
SET current_season = GREATEST(1,
  CEIL(
    (EXTRACT(YEAR FROM now()) - 2024) * 12 +
    EXTRACT(MONTH FROM now()) - 1
  )::int / 2 + 1
)
WHERE current_season = 1;

-- ── 2. season_history table ──────────────────────────────────
-- Stores each player's stats snapshot at end of each season.

CREATE TABLE IF NOT EXISTS season_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_number  INT         NOT NULL,
  tier           TEXT        NOT NULL DEFAULT 'Gold',
  wins           INT         NOT NULL DEFAULT 0,
  losses         INT         NOT NULL DEFAULT 0,
  points         INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, season_number)
);

CREATE INDEX IF NOT EXISTS season_history_user_idx ON season_history(user_id, season_number DESC);

-- RLS
ALTER TABLE season_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS season_history_select ON season_history;
CREATE POLICY season_history_select ON season_history
  FOR SELECT USING (true);

DROP POLICY IF EXISTS season_history_insert ON season_history;
CREATE POLICY season_history_insert ON season_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS season_history_upsert ON season_history;
CREATE POLICY season_history_upsert ON season_history
  FOR UPDATE USING (auth.uid() = user_id);

GRANT SELECT ON season_history TO anon;
GRANT SELECT, INSERT, UPDATE ON season_history TO authenticated;

-- ── 3. Tier progression constants (reference comment) ────────
-- Tiers in order: Gold → Platinum → Diamond → Ace → Conquer → Partner
-- Advance:  50 wins in a season (Gold/Platinum/Diamond)
--          100 wins in a season (Ace/Conquer — harder to escape)
-- Drop:    30+ losses last season → drop 1 tier when new season starts
--          Gold is the floor; you cannot drop below it.
--
-- All tier logic lives client-side in lib/seasons.js
-- so it can be used in both AuthProvider and any page component.

-- ── 4. Fix existing 'GOLD' tier values (case normalise) ──────
UPDATE profiles SET tier = 'Gold'     WHERE tier = 'GOLD';
UPDATE profiles SET tier = 'Platinum' WHERE tier = 'PLATINUM';
UPDATE profiles SET tier = 'Diamond'  WHERE tier = 'DIAMOND';
UPDATE profiles SET tier = 'Ace'      WHERE tier = 'ACE';
UPDATE profiles SET tier = 'Conquer'  WHERE tier = 'CONQUER';
UPDATE profiles SET tier = 'Partner'  WHERE tier = 'PARTNER';

-- Done.
