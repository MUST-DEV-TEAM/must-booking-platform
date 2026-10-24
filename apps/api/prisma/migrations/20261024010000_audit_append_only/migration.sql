-- Additive audit hardening. Existing tenant/property SELECT/INSERT policies stay intact.
-- Rollback: remove ONLY these two policies and index after reviewing application access.
-- Do not delete/rewrite audit evidence. Maintenance/retention authority is not granted here.
DROP POLICY IF EXISTS audit_application_no_update ON audit_logs;
CREATE POLICY audit_application_no_update ON audit_logs AS RESTRICTIVE FOR UPDATE TO must_booking_app USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS audit_application_no_delete ON audit_logs;
CREATE POLICY audit_application_no_delete ON audit_logs AS RESTRICTIVE FOR DELETE TO must_booking_app USING (false);
CREATE INDEX IF NOT EXISTS audit_logs_operation_reference ON audit_logs(tenant_id,property_id,(details#>>'{_audit,operationId}'),created_at DESC) WHERE details#>>'{_audit,operationId}' IS NOT NULL;
