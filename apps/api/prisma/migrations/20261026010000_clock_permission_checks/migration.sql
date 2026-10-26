-- The last read-only check of which Clock rights the API user has, one row per property.
CREATE TABLE IF NOT EXISTS clock_permission_checks (
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by UUID,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, property_id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(results) = 'array')
);
ALTER TABLE clock_permission_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_permission_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clock_permission_checks_scope ON clock_permission_checks;
CREATE POLICY clock_permission_checks_scope ON clock_permission_checks
  USING (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id())
  WITH CHECK (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id());
