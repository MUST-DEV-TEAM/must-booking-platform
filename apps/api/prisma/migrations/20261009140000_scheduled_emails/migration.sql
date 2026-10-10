-- Email plan Step 2a: scheduled emails (guest pre-arrival reminder, owner daily
-- summary). Additive. Both new emails start switched OFF for every property that
-- already exists, so live hotels get nothing new until someone turns them on;
-- properties created later get the defaults (on).

ALTER TABLE "notification_topic_settings"
  ADD COLUMN IF NOT EXISTS "staff_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  -- Days before arrival (pre-arrival) or after departure (post-stay); NULL = default.
  ADD COLUMN IF NOT EXISTS "days_offset" SMALLINT;
ALTER TABLE "notification_topic_settings" DROP CONSTRAINT IF EXISTS "notification_topic_settings_days_offset_check";
ALTER TABLE "notification_topic_settings" ADD CONSTRAINT "notification_topic_settings_days_offset_check"
  CHECK ("days_offset" IS NULL OR "days_offset" BETWEEN 0 AND 60);

INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "guest_enabled")
SELECT "tenant_id", "id", 'pre_arrival', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "staff_enabled")
SELECT "tenant_id", "id", 'owner_daily_summary', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;

-- The scheduled-email sweep visits every property; RLS hides other tenants from the
-- app role, so this definer function lists only what the sweep needs.
CREATE OR REPLACE FUNCTION "scheduled_email_properties"()
RETURNS TABLE ("tenantId" UUID, "propertyId" UUID, "timezone" VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tenant_id, p.id, p.timezone FROM properties p ORDER BY p.tenant_id, p.id
$$;
REVOKE ALL ON FUNCTION "scheduled_email_properties"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "scheduled_email_properties"() TO must_booking_app;
