-- ============================================================
-- Tournament Production Migration
-- Run this in your Supabase SQL Editor (safe to re-run)
-- ============================================================

-- ── 1. bracket_switches column on tournament_participants ────
ALTER TABLE tournament_participants
  ADD COLUMN IF NOT EXISTS bracket_switches INTEGER NOT NULL DEFAULT 0;

-- Enforce cap at DB level so no client can bypass the 3-switch limit
ALTER TABLE tournament_participants
  DROP CONSTRAINT IF EXISTS bracket_switches_max;
ALTER TABLE tournament_participants
  ADD CONSTRAINT bracket_switches_max CHECK (bracket_switches <= 3);

-- ── 2. RLS: allow users to update their own bracket_switches ──
-- (Run only if your tournament_participants table has RLS enabled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tournament_participants'
      AND policyname = 'participants_update_own_switches'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY participants_update_own_switches
        ON tournament_participants
        FOR UPDATE
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
    $policy$;
  END IF;
END$$;

-- ── 3. award_tournament_points RPC ──────────────────────────
-- Atomically adds points to tournament_leaderboard AND global
-- profiles.points in a single server-side call.
-- SECURITY DEFINER so admins can write other users' rows
-- without needing elevated RLS policies on the leaderboard.
CREATE OR REPLACE FUNCTION award_tournament_points(
  p_tournament_id UUID,
  p_user_id       UUID,
  p_points        INTEGER
)
RETURNS void AS $$
BEGIN
  -- Upsert into tournament leaderboard
  INSERT INTO tournament_leaderboard (tournament_id, user_id, points, position)
  VALUES (p_tournament_id, p_user_id, p_points, 99)
  ON CONFLICT (tournament_id, user_id)
  DO UPDATE SET points = tournament_leaderboard.points + EXCLUDED.points;

  -- Increment global profile points
  UPDATE profiles
  SET points = COALESCE(points, 0) + p_points
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (admin calls this via client)
GRANT EXECUTE ON FUNCTION award_tournament_points(UUID, UUID, INTEGER) TO authenticated;

-- ── 4. recalc_tournament_positions RPC ──────────────────────
-- Recalculates leaderboard positions for a tournament in a
-- single query instead of N sequential round-trips from the client.
CREATE OR REPLACE FUNCTION recalc_tournament_positions(p_tournament_id UUID)
RETURNS void AS $$
BEGIN
  WITH ranked AS (
    SELECT
      id,
      RANK() OVER (ORDER BY points DESC) AS new_position
    FROM tournament_leaderboard
    WHERE tournament_id = p_tournament_id
  )
  UPDATE tournament_leaderboard lb
  SET position = ranked.new_position
  FROM ranked
  WHERE lb.id = ranked.id
    AND lb.tournament_id = p_tournament_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recalc_tournament_positions(UUID) TO authenticated;

-- ── 5. Ensure tournament_leaderboard unique constraint exists ─
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

-- ── 6. Ensure increment_points RPC exists ────────────────────
CREATE OR REPLACE FUNCTION increment_points(uid UUID, amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET points = GREATEST(0, COALESCE(points, 0) + amount)
  WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION increment_points(UUID, INTEGER) TO authenticated;

-- ── Done ─────────────────────────────────────────────────────
-- After running this:
--   1. award_tournament_points handles both leaderboard + global atomically
--   2. recalc_tournament_positions replaces N round-trips with 1 RANK() query
--   3. bracket_switches is enforced at DB level (max 3)
--   4. increment_points now floors at 0 so points never go negative
