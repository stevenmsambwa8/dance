-- ============================================================
-- Migration: Group Chat + Direct Messages
-- Apply in Supabase SQL Editor
-- ============================================================

-- ── 1. game_chat_messages ──────────────────────────────────
-- WhatsApp-style group chat per game slug
CREATE TABLE IF NOT EXISTS game_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_slug   TEXT NOT NULL,
  sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_chat_messages_game_slug_idx  ON game_chat_messages(game_slug);
CREATE INDEX IF NOT EXISTS game_chat_messages_created_at_idx ON game_chat_messages(created_at);

-- RLS
ALTER TABLE game_chat_messages ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read group chat
DROP POLICY IF EXISTS "game_chat_select" ON game_chat_messages;
CREATE POLICY "game_chat_select"
  ON game_chat_messages FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can send messages as themselves
DROP POLICY IF EXISTS "game_chat_insert" ON game_chat_messages;
CREATE POLICY "game_chat_insert"
  ON game_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

-- Only sender or admin can delete
DROP POLICY IF EXISTS "game_chat_delete" ON game_chat_messages;
CREATE POLICY "game_chat_delete"
  ON game_chat_messages FOR DELETE
  TO authenticated
  USING (
    auth.uid() = sender_id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND email = 'stevenmsambwa8@gmail.com'
    )
  );

-- Realtime: enable for game_chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE game_chat_messages;


-- ── 2. direct_messages ────────────────────────────────────
-- 1-to-1 DM between users
-- thread_id = sorted UUIDs joined by '--' (double-dash) so no SQL wildcard issues
CREATE TABLE IF NOT EXISTS direct_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   TEXT NOT NULL,          -- e.g. "uuid-a--uuid-b" always sorted (UUIDs joined by double-dash)
  sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 1000),
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS direct_messages_thread_idx     ON direct_messages(thread_id);
CREATE INDEX IF NOT EXISTS direct_messages_receiver_idx   ON direct_messages(receiver_id);
CREATE INDEX IF NOT EXISTS direct_messages_created_at_idx ON direct_messages(created_at);

-- RLS
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- Participants can read messages in their thread
DROP POLICY IF EXISTS "dm_select" ON direct_messages;
CREATE POLICY "dm_select"
  ON direct_messages FOR SELECT
  TO authenticated
  USING (
    auth.uid() = sender_id
    OR auth.uid() = receiver_id
  );

-- Authenticated users can send as themselves
DROP POLICY IF EXISTS "dm_insert" ON direct_messages;
CREATE POLICY "dm_insert"
  ON direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

-- Receiver can mark as read
DROP POLICY IF EXISTS "dm_update" ON direct_messages;
CREATE POLICY "dm_update"
  ON direct_messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = receiver_id);

-- Only sender can delete their own messages
DROP POLICY IF EXISTS "dm_delete" ON direct_messages;
CREATE POLICY "dm_delete"
  ON direct_messages FOR DELETE
  TO authenticated
  USING (auth.uid() = sender_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;


-- ── 3. Notifications: allow direct_message type ───────────
-- The notifications table already exists; no schema change needed.
-- The app inserts with type = 'direct_message' and type = 'group_chat'
-- which are already handled by the existing notifications RLS.
-- Reminder: ensure your notifications SELECT policy covers these types.


-- ── 4. /contact → /players rename ────────────────────────
-- No database change required — this is a Next.js route rename only.
-- The underlying data (profiles table) is unchanged.
-- Nav.js and any internal links have been updated to /players in the app.


-- ── 5. (Optional) Unread DM count helper ─────────────────
-- Returns count of unread DMs for a user — useful for future badge
CREATE OR REPLACE FUNCTION get_unread_dm_count(uid UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM direct_messages
  WHERE receiver_id = uid AND read = FALSE;
$$ LANGUAGE sql SECURITY DEFINER;


-- ── 6. Named FK alias for direct_messages sender join ──────
-- The DM page uses:
--   .select('*, sender:profiles!direct_messages_sender_id_fkey(...)')
-- This requires the FK constraint name to be direct_messages_sender_id_fkey.
-- Supabase auto-names it this way when the table and FK column match.
-- If you get a join error, verify with:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'direct_messages'::regclass;
-- And update the select alias in page.js to match the actual constraint name.
