-- Prospective observation only; no invented historical delivery timeline.
CREATE TABLE IF NOT EXISTS email_delivery_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('QUEUED','ATTEMPT','RETRY_WAIT','SENT','FAILED','DELIVERED','BOUNCED','COMPLAINED','SUPPRESSED')),
 status TEXT NOT NULL,attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),provider VARCHAR(40),provider_message_id VARCHAR(200),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS email_delivery_events_message ON email_delivery_events(tenant_id,property_id,message_id,observed_at,id);
ALTER TABLE email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_delivery_event_scope ON email_delivery_events;
CREATE POLICY email_delivery_event_scope ON email_delivery_events
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
CREATE OR REPLACE FUNCTION observe_email_delivery_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_kind TEXT;
BEGIN
 IF NEW.tenant_id IS NULL OR NEW.property_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN event_kind=NEW.status::text;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event_kind=NEW.status::text;
 ELSIF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count THEN event_kind='ATTEMPT';
 ELSIF NEW.status='QUEUED' AND NEW.last_error IS DISTINCT FROM OLD.last_error AND NEW.last_error IS NOT NULL THEN event_kind='RETRY_WAIT';
 ELSE RETURN NEW;
 END IF;
 INSERT INTO email_delivery_events(tenant_id,property_id,message_id,kind,status,attempt_count,provider,provider_message_id)
 VALUES(NEW.tenant_id,NEW.property_id,NEW.id,event_kind,NEW.status::text,NEW.attempt_count,NEW.provider,NEW.provider_message_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS email_delivery_observer ON email_messages;
CREATE TRIGGER email_delivery_observer AFTER INSERT OR UPDATE ON email_messages FOR EACH ROW EXECUTE FUNCTION observe_email_delivery_event();
