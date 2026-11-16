-- A guest who asks online to cancel gets an email saying the request arrived (audit L15). Data only: it starts
-- switched OFF for every property that already exists, so no real hotel's guests get a new email until the hotel
-- turns it on; properties created later get it on. Safe to run again.
-- Roll back with: DELETE FROM "notification_topic_settings" WHERE "topic" = 'cancellation_request_received';
INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "guest_enabled")
SELECT "tenant_id", "id", 'cancellation_request_received', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
