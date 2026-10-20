-- Additive; existing tenant/property forced-RLS policies remain in force.
-- Rollback application first, preserving approved envelopes and outcome evidence.
ALTER TABLE notification_recipient_rules ADD COLUMN IF NOT EXISTS channel VARCHAR(3);
ALTER TABLE notification_recipient_rules ALTER COLUMN channel DROP NOT NULL;
ALTER TABLE notification_recipient_rules ALTER COLUMN channel DROP DEFAULT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='notification_recipient_channel_valid') THEN
 ALTER TABLE notification_recipient_rules ADD CONSTRAINT notification_recipient_channel_valid CHECK(channel IN ('TO','CC','BCC'));
 END IF;
END $$;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS recipient_envelope JSONB;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS recipient_outcomes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE email_delivery_slots ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='email_slot_recipient_count_valid') THEN
 ALTER TABLE email_delivery_slots ADD CONSTRAINT email_slot_recipient_count_valid CHECK(recipient_count BETWEEN 1 AND 100);
 END IF;
END $$;

ALTER TABLE notification_recipient_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_recipient_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_slots FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='email_staff_envelope_valid') THEN
 ALTER TABLE email_messages ADD CONSTRAINT email_staff_envelope_valid CHECK(recipient_envelope IS NULL OR COALESCE(
   tenant_id IS NOT NULL AND property_id IS NOT NULL AND jsonb_typeof(recipient_envelope)='object'
   AND jsonb_typeof(recipient_envelope->'to')='array' AND jsonb_typeof(recipient_envelope->'cc')='array' AND jsonb_typeof(recipient_envelope->'bcc')='array'
   AND jsonb_array_length(recipient_envelope->'to')>=1
   AND jsonb_array_length(recipient_envelope->'to')+jsonb_array_length(recipient_envelope->'cc')+jsonb_array_length(recipient_envelope->'bcc') BETWEEN 1 AND 100
   AND recipient_envelope - ARRAY['to','cc','bcc'] = '{}'::jsonb, false));
 END IF;
END $$;
