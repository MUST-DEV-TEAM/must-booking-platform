CREATE TABLE IF NOT EXISTS inventory_stock_operations (
 tenant_id UUID NOT NULL, property_id UUID NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,property_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE inventory_stock_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_stock_isolation ON inventory_stock_operations;
CREATE POLICY inventory_stock_isolation ON inventory_stock_operations
 USING (tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK (tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
-- Additive rollback: revert application first. Retain receipts for safe retries and audit retention.
-- To remove later, export receipts before dropping the table; no stock data is migrated.
