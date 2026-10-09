-- Email plan Step 6: the post-stay thank-you with review links. Additive. The new
-- email starts switched OFF for every property that already exists; properties
-- created later get it on by default.

-- Review links the thank-you email shows as buttons, e.g. {"google": "https://…"}.
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "review_links" JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "guest_enabled")
SELECT "tenant_id", "id", 'post_stay', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
