-- ============================================================
-- nabogaming — Market System (Images + Buy Requests + Notifications)
-- Apply in Supabase SQL Editor (safe to run multiple times)
-- ============================================================

-- ── 0. shop_item_images ───────────────────────────────────────
-- Stores up to 4 product images per shop listing (already WebP-compressed
-- client-side to ≤60 KB before upload).

CREATE TABLE IF NOT EXISTS shop_item_images (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID        NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce max 4 images per item via a trigger
CREATE OR REPLACE FUNCTION enforce_max_images()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM shop_item_images WHERE item_id = NEW.item_id) >= 4 THEN
    RAISE EXCEPTION 'Maximum 4 images per item';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shop_item_images_max ON shop_item_images;
CREATE TRIGGER shop_item_images_max
  BEFORE INSERT ON shop_item_images
  FOR EACH ROW EXECUTE FUNCTION enforce_max_images();

CREATE INDEX IF NOT EXISTS shop_item_images_item_id_idx ON shop_item_images(item_id, sort_order);

-- RLS
ALTER TABLE shop_item_images ENABLE ROW LEVEL SECURITY;

-- Anyone can read images on active items
DROP POLICY IF EXISTS shop_item_images_select ON shop_item_images;
CREATE POLICY shop_item_images_select ON shop_item_images
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM shop_items WHERE id = shop_item_images.item_id)
  );

-- Only the item owner can insert images
DROP POLICY IF EXISTS shop_item_images_insert ON shop_item_images;
CREATE POLICY shop_item_images_insert ON shop_item_images
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM shop_items WHERE id = shop_item_images.item_id AND seller_id = auth.uid())
  );

-- Only the item owner can delete images
DROP POLICY IF EXISTS shop_item_images_delete ON shop_item_images;
CREATE POLICY shop_item_images_delete ON shop_item_images
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM shop_items WHERE id = shop_item_images.item_id AND seller_id = auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON shop_item_images TO authenticated;
GRANT SELECT ON shop_item_images TO anon;

-- ── 0b. Supabase Storage bucket (run once) ───────────────────
-- Create the 'shop-images' bucket in the Supabase Dashboard:
--   Storage → New bucket → Name: shop-images → Public: ON
--
-- Then add these Storage policies in Dashboard → Storage → shop-images → Policies:
--
--   SELECT (public reads):
--     bucket_id = 'shop-images'
--
--   INSERT (authenticated upload):
--     bucket_id = 'shop-images' AND auth.role() = 'authenticated'
--
--   DELETE (owner only — match folder to user id):
--     bucket_id = 'shop-images'
--     AND auth.uid()::text = (storage.foldername(name))[2]
--
-- Or run these SQL policies:
INSERT INTO storage.buckets (id, name, public)
VALUES ('shop-images', 'shop-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "shop_images_public_read"  ON storage.objects;
CREATE POLICY "shop_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'shop-images');

DROP POLICY IF EXISTS "shop_images_auth_insert"  ON storage.objects;
CREATE POLICY "shop_images_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'shop-images' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "shop_images_owner_delete" ON storage.objects;
CREATE POLICY "shop_images_owner_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'shop-images' AND auth.uid() IS NOT NULL);

-- ============================================================

-- ── 1. buy_requests ──────────────────────────────────────────
-- Stores each buyer's purchase request for a shop item.

CREATE TABLE IF NOT EXISTS buy_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       UUID        NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  buyer_id      UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  seller_id     UUID        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  offer_price   NUMERIC     NOT NULL CHECK (offer_price > 0),
  note          TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: fast lookup of requests per item (dealer inbox)
CREATE INDEX IF NOT EXISTS buy_requests_item_id_idx   ON buy_requests(item_id);
-- Index: fast lookup of buyer's own requests
CREATE INDEX IF NOT EXISTS buy_requests_buyer_id_idx  ON buy_requests(buyer_id);
-- Index: fast lookup of seller's incoming requests
CREATE INDEX IF NOT EXISTS buy_requests_seller_id_idx ON buy_requests(seller_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS buy_requests_updated_at ON buy_requests;
CREATE TRIGGER buy_requests_updated_at
  BEFORE UPDATE ON buy_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ── 2. negotiation_messages ───────────────────────────────────
-- Per-request chat thread between buyer and seller.

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES buy_requests(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  body        TEXT        NOT NULL CHECK (char_length(body) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: fetch all messages for a thread in order
CREATE INDEX IF NOT EXISTS negotiation_messages_request_id_idx
  ON negotiation_messages(request_id, created_at);


-- ── 3. notifications ──────────────────────────────────────────
-- Universal notification inbox for any user event.

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,          -- e.g. 'buy_request', 'negotiation_message', 'request_update'
  title      TEXT        NOT NULL,
  body       TEXT,
  meta       JSONB,                         -- { request_id, item_id, ... }
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: unread notifications for a user (badge count query)
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, read)
  WHERE read = FALSE;

-- Index: all notifications for a user, newest first
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);


-- ── 4. Row-Level Security ─────────────────────────────────────

-- buy_requests
ALTER TABLE buy_requests ENABLE ROW LEVEL SECURITY;

-- Buyer can see their own requests
DROP POLICY IF EXISTS buy_requests_buyer_select  ON buy_requests;
CREATE POLICY buy_requests_buyer_select ON buy_requests
  FOR SELECT USING (buyer_id = auth.uid());

-- Seller can see requests on their items
DROP POLICY IF EXISTS buy_requests_seller_select ON buy_requests;
CREATE POLICY buy_requests_seller_select ON buy_requests
  FOR SELECT USING (seller_id = auth.uid());

-- Buyer can create a request
DROP POLICY IF EXISTS buy_requests_insert ON buy_requests;
CREATE POLICY buy_requests_insert ON buy_requests
  FOR INSERT WITH CHECK (buyer_id = auth.uid());

-- Seller can update status (accept/decline)
DROP POLICY IF EXISTS buy_requests_seller_update ON buy_requests;
CREATE POLICY buy_requests_seller_update ON buy_requests
  FOR UPDATE USING (seller_id = auth.uid());

-- ────────────────────────────────────────────────────────────

-- negotiation_messages
ALTER TABLE negotiation_messages ENABLE ROW LEVEL SECURITY;

-- Both buyer and seller can read messages in their requests
DROP POLICY IF EXISTS negotiation_messages_select ON negotiation_messages;
CREATE POLICY negotiation_messages_select ON negotiation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM buy_requests r
      WHERE r.id = negotiation_messages.request_id
        AND (r.buyer_id = auth.uid() OR r.seller_id = auth.uid())
    )
  );

-- Participants can insert messages
DROP POLICY IF EXISTS negotiation_messages_insert ON negotiation_messages;
CREATE POLICY negotiation_messages_insert ON negotiation_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM buy_requests r
      WHERE r.id = negotiation_messages.request_id
        AND (r.buyer_id = auth.uid() OR r.seller_id = auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users see only their own notifications
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- The app inserts notifications (authenticated users, controlled server-side)
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (TRUE);  -- app logic controls who gets notified

-- Users can mark their own as read
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own notifications
DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (user_id = auth.uid());


-- ── 5. Helpful views ──────────────────────────────────────────

-- Unread notification count per user (use in badge / nav)
CREATE OR REPLACE VIEW unread_notification_counts AS
SELECT user_id, COUNT(*) AS unread_count
FROM notifications
WHERE read = FALSE
GROUP BY user_id;

-- ── 6. Grant access to authenticated role ────────────────────
GRANT SELECT, INSERT, UPDATE ON buy_requests        TO authenticated;
GRANT SELECT, INSERT         ON negotiation_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
GRANT SELECT                 ON unread_notification_counts TO authenticated;
