-- ============================================================
-- DANCE Platform — DB Migrations
-- Apply these in your Supabase SQL Editor
-- ============================================================

-- ── 1. Add ticker_text column to matches table ──
-- Used for admin-controlled scrolling live text on match pages
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ticker_text TEXT;

-- ── 2. Update profiles.tier to support new rank system ──
-- Ranks: Gold → Platinum → Diamond → Ace → Conquer → Partner
-- No structural change needed (still TEXT), but add a check constraint:
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_tier_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_check
  CHECK (tier IS NULL OR tier IN ('Gold', 'Platinum', 'Diamond', 'Ace', 'Conquer', 'Partner'));

-- Set default tier for existing users with no tier set
UPDATE profiles
  SET tier = 'Gold'
  WHERE tier IS NULL OR tier NOT IN ('Gold', 'Platinum', 'Diamond', 'Ace', 'Conquer', 'Partner');

-- ── 3. Update game_subscriptions + tournaments to use new game slugs ──
-- New valid slugs: pubg, freefire, codm, maleo_bussid, efootball, dls
-- Migrate old slugs to closest equivalent (valorant → codm, 'other' → dls)
UPDATE game_subscriptions SET game_slug = 'codm'  WHERE game_slug = 'valorant';
UPDATE game_subscriptions SET game_slug = 'dls'   WHERE game_slug = 'other';
UPDATE tournaments        SET game_slug = 'codm'  WHERE game_slug = 'valorant';
UPDATE tournaments        SET game_slug = 'dls'   WHERE game_slug = 'other';

-- Add check constraint on game_slug for tournaments
ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_game_slug_check;

ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_game_slug_check
  CHECK (game_slug IN ('pubg', 'freefire', 'codm', 'maleo_bussid', 'efootball', 'dls'));

-- Add check constraint on game_slug for game_subscriptions
ALTER TABLE game_subscriptions
  DROP CONSTRAINT IF EXISTS game_subscriptions_game_slug_check;

ALTER TABLE game_subscriptions
  ADD CONSTRAINT game_subscriptions_game_slug_check
  CHECK (game_slug IN ('pubg', 'freefire', 'codm', 'maleo_bussid', 'efootball', 'dls'));

-- ── 4. Remove Bo1/Bo3/Bo5 constraint from matches (format is now free text) ──
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_format_check;

-- ── 5. Create increment_points RPC if it doesn't exist ──
CREATE OR REPLACE FUNCTION increment_points(uid UUID, amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE profiles SET points = COALESCE(points, 0) + amount WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. Ensure tournament_leaderboard has unique constraint ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_leaderboard_tournament_id_user_id_key'
  ) THEN
    ALTER TABLE tournament_leaderboard
      ADD CONSTRAINT tournament_leaderboard_tournament_id_user_id_key
      UNIQUE (tournament_id, user_id);
  END IF;
END$$;

-- ── 7. RLS policies reminder ──
-- If RLS is enabled on matches, ensure the ticker_text column is readable:
-- The existing SELECT policy on matches should cover ticker_text automatically.
-- If you have a restrictive column-level policy, run:
-- GRANT SELECT (ticker_text) ON matches TO authenticated, anon;
-- GRANT UPDATE (ticker_text) ON matches TO authenticated;

-- ── 6. Verified tick — make email accessible on profiles ──
-- The feed and profile pages check profiles.email === ADMIN_EMAIL to show the tick.
-- Make sure your RLS policy on profiles allows reading the email column,
-- OR store a boolean verified column instead:
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- To manually verify a user (run once for admin):
-- UPDATE profiles SET is_verified = TRUE WHERE email = 'stevenmsambwa8@gmail.com';

-- ── Online presence column ──
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS online_status TEXT DEFAULT 'offline'
  CHECK (online_status IN ('online', 'away', 'offline'));

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS profiles_online_status_idx ON profiles(online_status);

-- Allow authenticated users to update their own online_status
-- (should already be covered by your existing profiles RLS policy)

-- ── Bracket data column for tournaments ──
-- Stores the full bracket JSON (rounds, player statuses, etc.)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS bracket_data JSONB;
