CREATE TABLE IF NOT EXISTS email_transport_failures (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,notification_id UUID NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('UNKNOWN','FAILED','FALLBACK_USED')),
 alert_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,message_id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS email_transport_failure_outbox (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,owner_user_id UUID NOT NULL,
 recipient_email TEXT NOT NULL,command JSONB NOT NULL CHECK(jsonb_typeof(command)='object'),
 published_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(tenant_id,property_id,message_id,owner_user_id),
 FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_transport_failures(tenant_id,property_id,message_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS email_transport_failure_recent ON email_transport_failures(tenant_id,property_id,alert_started_at DESC);
ALTER TABLE email_transport_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_transport_failures FORCE ROW LEVEL SECURITY;
ALTER TABLE email_transport_failure_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_transport_failure_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_transport_failure_scope ON email_transport_failures;
CREATE POLICY email_transport_failure_scope ON email_transport_failures
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
DROP POLICY IF EXISTS email_transport_failure_outbox_scope ON email_transport_failure_outbox;
CREATE POLICY email_transport_failure_outbox_scope ON email_transport_failure_outbox
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
-- Application-first rollback retains failure evidence; scoped expiry removes outbox bodies.
