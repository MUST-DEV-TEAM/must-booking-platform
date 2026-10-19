CREATE TABLE IF NOT EXISTS email_suppression_events (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,event_hash CHAR(64) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,message_id,event_hash),FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE
);
ALTER TABLE email_suppression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppression_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppression_event_scope ON email_suppression_events;
CREATE POLICY email_suppression_event_scope ON email_suppression_events USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
