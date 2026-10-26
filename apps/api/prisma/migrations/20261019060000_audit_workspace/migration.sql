ALTER TABLE properties ADD COLUMN IF NOT EXISTS audit_export_version integer NOT NULL DEFAULT 0 CHECK(audit_export_version>=0);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_context jsonb;
CREATE INDEX IF NOT EXISTS audit_logs_property_created ON audit_logs(tenant_id,property_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS audit_export_operations(
 tenant_id uuid NOT NULL,property_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key varchar(128) NOT NULL,request_hash varchar(64) NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,user_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS audit_export_operations_expiry ON audit_export_operations(tenant_id,property_id,created_at);
ALTER TABLE audit_export_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_export_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exact_scope ON audit_export_operations;
CREATE POLICY exact_scope ON audit_export_operations USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
