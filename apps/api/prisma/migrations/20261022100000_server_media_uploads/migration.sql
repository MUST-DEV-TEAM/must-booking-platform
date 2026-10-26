-- Additive. Rollback: disable local uploads and archive media and intents before any owner-approved removal.
CREATE TABLE IF NOT EXISTS server_media_uploads (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,property_id UUID NOT NULL,
 token_hash VARCHAR(64) NOT NULL UNIQUE,object_key TEXT NOT NULL UNIQUE,content_type VARCHAR(40) NOT NULL,
 content_length INTEGER NOT NULL CHECK(content_length BETWEEN 1 AND 10485760),expires_at TIMESTAMPTZ NOT NULL,
 uploaded_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id)
);
ALTER TABLE server_media_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_media_uploads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS server_media_scope ON server_media_uploads;
CREATE POLICY server_media_scope ON server_media_uploads USING(tenant_id::text=current_setting('app.tenant_id',true) AND property_id::text=current_setting('app.property_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND property_id::text=current_setting('app.property_id',true));
GRANT SELECT,INSERT,UPDATE ON server_media_uploads TO must_booking_app;
