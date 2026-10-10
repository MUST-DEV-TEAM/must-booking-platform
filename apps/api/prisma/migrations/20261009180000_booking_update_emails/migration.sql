-- Email plan Step 2c: guest emails for a booking changed at the hotel and for a
-- booking whose payment was not completed. Data only. Both start switched OFF for
-- every property that already exists; properties created later get them on.

INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "guest_enabled")
SELECT "tenant_id", "id", 'booking_changed', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "guest_enabled")
SELECT "tenant_id", "id", 'payment_not_completed', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
