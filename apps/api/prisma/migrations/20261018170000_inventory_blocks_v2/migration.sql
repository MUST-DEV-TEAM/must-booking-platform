ALTER TABLE availability_blocks
  ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT 'Manual block',
  ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'Active' CHECK (lifecycle IN ('Draft','Scheduled','Active','Ended','Cancelled')),
  ADD COLUMN IF NOT EXISTS responsible_staff_id UUID,
  ADD COLUMN IF NOT EXISTS end_reason VARCHAR(4000),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS scope_locked BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS inventory_reference VARCHAR(40);
CREATE TABLE IF NOT EXISTS inventory_block_operations (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,idempotency_key), FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS inventory_block_sequences (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, year INTEGER NOT NULL, last_value INTEGER NOT NULL CHECK(last_value>0),
 PRIMARY KEY(tenant_id,property_id,year), FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE tab TEXT; BEGIN
 FOREACH tab IN ARRAY ARRAY['inventory_block_operations','inventory_block_sequences'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS inventory_block_isolation ON %I',tab);
 EXECUTE format('CREATE POLICY inventory_block_isolation ON %I USING (tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK (tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',tab);
 END LOOP;
END $$;
-- Additive rollback: revert application first; retain new columns and receipts until exported.
-- Old records remain Active with locked scope; availability remains date bounded.
