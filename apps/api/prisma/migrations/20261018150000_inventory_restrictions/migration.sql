CREATE TABLE IF NOT EXISTS inventory_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, property_id UUID NOT NULL,
  reference VARCHAR(32) NOT NULL, name VARCHAR(200) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('minimum_stay','maximum_stay','closed_to_arrival','closed_to_departure','stop_sell','minimum_advance')),
  value INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('property','category','room_type')),
  target_ids UUID[] NOT NULL DEFAULT '{}',
  starts_on DATE NOT NULL, ends_on DATE,
  weekdays INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  lifecycle TEXT NOT NULL DEFAULT 'Draft' CHECK (lifecycle IN ('Draft','Scheduled','Active','Paused','Expired','Archived')),
  internal_reason TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id UUID NOT NULL, updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_restrictions_property_fk FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,property_id,id), UNIQUE (tenant_id,property_id,reference),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]),
  CHECK ((scope = 'property' AND cardinality(target_ids) = 0) OR (scope <> 'property' AND cardinality(target_ids) > 0)),
  CHECK ((type IN ('closed_to_arrival','closed_to_departure','stop_sell') AND value IN (0,1)) OR (type IN ('minimum_stay','maximum_stay') AND value >= 1) OR (type = 'minimum_advance' AND value >= 0))
);
CREATE INDEX IF NOT EXISTS inventory_restrictions_schedule_idx ON inventory_restrictions(tenant_id,property_id,lifecycle,starts_on,ends_on);
-- Target IDs are scoped and verified in the serialized write transaction. Keep their identity
-- after catalog deletion; a missing category/type never widens a rule to property scope.
CREATE TABLE IF NOT EXISTS inventory_restriction_sequences (
  tenant_id UUID NOT NULL, property_id UUID NOT NULL, year INTEGER NOT NULL, last_value INTEGER NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (tenant_id,property_id,year),
  FOREIGN KEY (tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS inventory_restriction_operations (
  tenant_id UUID NOT NULL, property_id UUID NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,property_id,idempotency_key),
  FOREIGN KEY (tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE tab TEXT; BEGIN
  FOREACH tab IN ARRAY ARRAY['inventory_restrictions','inventory_restriction_sequences','inventory_restriction_operations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('DROP POLICY IF EXISTS inventory_restriction_isolation ON %I', tab);
    EXECUTE format('CREATE POLICY inventory_restriction_isolation ON %I USING (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id()) WITH CHECK (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id())', tab);
  END LOOP;
END $$;
-- Rollback after reverting the application: remove the three inventory_restriction* tables
-- only after exporting restrictions, operation receipts and audit history. No booking is changed.
