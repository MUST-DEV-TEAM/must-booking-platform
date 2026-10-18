CREATE TABLE IF NOT EXISTS report_views (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, id UUID NOT NULL DEFAULT gen_random_uuid(),
 owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 name VARCHAR(120) NOT NULL CHECK(length(btrim(name))>0), visibility TEXT NOT NULL CHECK(visibility IN ('private','team')),
 configuration JSONB NOT NULL CHECK(jsonb_typeof(configuration)='object'), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,id),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS report_views_owner ON report_views(tenant_id,property_id,owner_user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS report_views_team ON report_views(tenant_id,property_id,updated_at DESC) WHERE visibility='team';
CREATE TABLE IF NOT EXISTS report_view_operations (
 tenant_id UUID NOT NULL,property_id UUID NOT NULL,idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,idempotency_key),FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['report_views','report_view_operations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS report_scope ON %I',tab);
 EXECUTE format('CREATE POLICY report_scope ON %I USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',tab);
 END LOOP;
END $$;
-- Additive rollback: revert application first; retain/export views and retry receipts.
-- No report fact, booking or monetary record is modified.
