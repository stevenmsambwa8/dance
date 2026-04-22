-- ─────────────────────────────────────────────────────────────
-- FIX: Allow users to delete their own notifications
-- Run this in your Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Add DELETE RLS policy
DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (user_id = auth.uid());

-- 2. Grant DELETE permission to authenticated users
GRANT DELETE ON notifications TO authenticated;
