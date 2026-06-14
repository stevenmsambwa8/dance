-- ============================================================
-- NABOGAMING — Settings Page SQL
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ADD MISSING COLUMNS TO profiles
--    (safe — uses IF NOT EXISTS pattern via DO block)
-- ────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone              TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notif_match        BOOLEAN     DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_shop         BOOLEAN     DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_tournament   BOOLEAN     DEFAULT TRUE;


-- ────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY — profiles
--    Users can only update their own row.
--    The settings page calls updateProfile() which does:
--    supabase.from('profiles').update(updates).eq('id', user.id)
-- ────────────────────────────────────────────────────────────

-- Enable RLS if not already on
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read any profile (for leaderboard, players list, etc.)
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all"
  ON profiles FOR SELECT
  USING (true);

-- Allow users to update ONLY their own profile
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING      (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow users to insert their own profile (signup)
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- ────────────────────────────────────────────────────────────
-- 3. SECURE DELETE — cascade all user data
--
--    The settings page does:
--      supabase.from('profiles').delete().eq('id', user.id)
--      supabase.auth.signOut()
--
--    But that leaves orphaned rows everywhere. This function
--    deletes everything atomically and then removes the auth user.
--
--    We expose it as a Postgres function that the client calls
--    via supabase.rpc('delete_my_account') — update the settings
--    page's delete handler to use this instead.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as DB owner so it can delete auth.users
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  -- Guard: must be authenticated
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Comments and likes (children of posts)
  DELETE FROM comments   WHERE user_id = uid;
  DELETE FROM post_likes WHERE user_id = uid;
  DELETE FROM posts      WHERE user_id = uid;

  -- 2. Messages
  DELETE FROM game_chat_messages WHERE user_id = uid;
  DELETE FROM direct_messages    WHERE sender_id = uid OR receiver_id = uid;
  DELETE FROM negotiation_messages WHERE sender_id = uid;

  -- 3. Shop — requests, then items
  DELETE FROM buy_requests WHERE buyer_id = uid OR seller_id = uid;
  DELETE FROM shop_item_images
    WHERE item_id IN (SELECT id FROM shop_items WHERE seller_id = uid);
  DELETE FROM shop_items WHERE seller_id = uid;

  -- 4. Matches & score requests
  DELETE FROM score_requests WHERE requester_id = uid OR opponent_id = uid;
  DELETE FROM matches WHERE challenger_id = uid OR challenged_id = uid;

  -- 5. Tournaments
  DELETE FROM tournament_payments     WHERE user_id = uid;
  DELETE FROM tournament_participants WHERE user_id = uid;
  DELETE FROM tournament_leaderboard  WHERE user_id = uid;

  -- 6. Earnings
  DELETE FROM earnings_log WHERE user_id = uid;

  -- 7. Follows
  DELETE FROM follows WHERE follower_id = uid OR following_id = uid;

  -- 8. Notifications
  DELETE FROM notifications WHERE user_id = uid;

  -- 9. Achievements and season history
  DELETE FROM achievements   WHERE user_id = uid;
  DELETE FROM season_history WHERE user_id = uid;

  -- 10. Game subscriptions
  DELETE FROM game_subscriptions WHERE user_id = uid;

  -- 11. Profile row
  DELETE FROM profiles WHERE id = uid;

  -- NOTE: auth.users deletion is handled by the Next.js API route
  -- using supabase.auth.admin.deleteUser() with the service_role key.
  -- That is more reliable than deleting from auth.users directly.
END;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION delete_my_account() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_my_account() TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 4. RLS POLICIES FOR RELATED TABLES
--    (only needed if not already set — safe to re-run)
-- ────────────────────────────────────────────────────────────

-- Allow users to delete their own posts
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posts_delete_own" ON posts;
CREATE POLICY "posts_delete_own"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- Allow users to delete their own shop items
ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shop_items_delete_own" ON shop_items;
CREATE POLICY "shop_items_delete_own"
  ON shop_items FOR DELETE
  USING (auth.uid() = seller_id);

-- Allow users to delete their own messages
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dm_delete_own" ON direct_messages;
CREATE POLICY "dm_delete_own"
  ON direct_messages FOR DELETE
  USING (auth.uid() = sender_id);

-- Allow users to delete their own follow rows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "follows_delete_own" ON follows;
CREATE POLICY "follows_delete_own"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id OR auth.uid() = following_id);


-- ────────────────────────────────────────────────────────────
-- 5. UPDATE THE APP — use supabase.rpc instead of direct delete
--    In settings/page.js, replace the delete handler with:
--
--    await supabase.rpc('delete_my_account')
--    await supabase.auth.signOut()
--    router.push('/login')
--
--    The SQL function handles all cascading deletes atomically.
-- ────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────
-- 6. USEFUL INDEXES (performance)
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_tier
  ON profiles (tier);

CREATE INDEX IF NOT EXISTS idx_profiles_country_flag
  ON profiles (country_flag);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON follows (follower_id);

CREATE INDEX IF NOT EXISTS idx_follows_following
  ON follows (following_id);


-- ────────────────────────────────────────────────────────────
-- DONE ✓
-- Run each block once. Safe to re-run (uses IF NOT EXISTS /
-- DROP POLICY IF EXISTS / CREATE OR REPLACE).
-- ────────────────────────────────────────────────────────────
