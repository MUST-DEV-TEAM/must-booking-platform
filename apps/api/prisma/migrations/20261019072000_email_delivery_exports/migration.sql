ALTER TABLE properties ADD COLUMN IF NOT EXISTS email_delivery_export_version INTEGER NOT NULL DEFAULT 0 CHECK(email_delivery_export_version>=0);
CREATE TABLE IF NOT EXISTS email_delivery_exports (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,user_id UUID NOT NULL REFERENCES users(id),idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,user_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS email_delivery_exports_expiry ON email_delivery_exports(tenant_id,property_id,created_at);
ALTER TABLE email_delivery_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_delivery_export_scope ON email_delivery_exports;
CREATE POLICY email_delivery_export_scope ON email_delivery_exports
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
