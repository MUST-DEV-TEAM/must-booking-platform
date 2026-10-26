-- Read-only provider projection: no fabricated email or change to local guest matching.
CREATE TABLE IF NOT EXISTS clock_guest_profiles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,property_id UUID NOT NULL,connection_id UUID NOT NULL,
 external_guest_id VARCHAR(64) NOT NULL,email VARCHAR(320),first_name VARCHAR(100),last_name VARCHAR(100),phone VARCHAR(100),
 provider_updated_at TIMESTAMPTZ(6),synced_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CONSTRAINT clock_guest_profiles_property_fk FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT clock_guest_profiles_connection_fk FOREIGN KEY(tenant_id,connection_id) REFERENCES integration_connections(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT clock_guest_profiles_identity UNIQUE(tenant_id,property_id,connection_id,external_guest_id)
);
ALTER TABLE clock_guest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_guest_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clock_guest_profiles_scope ON clock_guest_profiles;
CREATE POLICY clock_guest_profiles_scope ON clock_guest_profiles
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND property_id=NULLIF(current_setting('app.property_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND property_id=NULLIF(current_setting('app.property_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON clock_guest_profiles TO must_booking_app;
-- Rollback: disable the guest-import UI/controller first; archive/export this reproducible
-- projection before an owner-authorized DROP TABLE clock_guest_profiles. No automatic deletion.
