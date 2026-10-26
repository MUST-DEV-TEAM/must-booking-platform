-- Prepared content is sanitized before encryption; sensitive account-link commands are excluded.
CREATE TABLE IF NOT EXISTS email_message_previews (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,message_id UUID NOT NULL,encrypted_preview TEXT NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(tenant_id,property_id,message_id),
 FOREIGN KEY(tenant_id,property_id,message_id) REFERENCES email_messages(tenant_id,property_id,id) ON DELETE CASCADE,
 CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '7 days')
);
CREATE INDEX IF NOT EXISTS email_message_previews_expiry ON email_message_previews(tenant_id,property_id,expires_at);
ALTER TABLE email_message_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_message_previews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_message_preview_scope ON email_message_previews;
CREATE POLICY email_message_preview_scope ON email_message_previews
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
