-- Additive durable read-only synchronization. Rollback: disable CLOCK_BACKGROUND_SYNC_ENABLED,
-- archive these local projections/checkpoints, then owner-approved DROP of the function/table.
CREATE TABLE IF NOT EXISTS clock_sync_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,property_id UUID NOT NULL,connection_id UUID NOT NULL,
 resource VARCHAR(80) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','RUNNING','RETRY','FAILED','SYNCED')),
 progress JSONB NOT NULL DEFAULT '{}'::jsonb,snapshot JSONB,last_success_at TIMESTAMPTZ,next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_token UUID,lease_until TIMESTAMPTZ,last_error VARCHAR(300),processed INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT clock_sync_jobs_property_fk FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT clock_sync_jobs_connection_fk FOREIGN KEY(tenant_id,connection_id) REFERENCES integration_connections(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT clock_sync_jobs_scope UNIQUE(tenant_id,property_id,connection_id,resource)
);
ALTER TABLE clock_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_sync_jobs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clock_sync_jobs' AND policyname='clock_sync_jobs_scope') THEN
 CREATE POLICY clock_sync_jobs_scope ON clock_sync_jobs USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND property_id=NULLIF(current_setting('app.property_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND property_id=NULLIF(current_setting('app.property_id',true),'')::uuid);
 END IF; END $$;
GRANT SELECT,INSERT,UPDATE ON clock_sync_jobs TO must_booking_app;
CREATE OR REPLACE FUNCTION clock_sync_properties(maximum_rows INTEGER DEFAULT 50)
RETURNS TABLE("tenantId" UUID,"propertyId" UUID,"connectionId" UUID)
LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT pc.tenant_id,pc.property_id,pc.connection_id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id
 WHERE pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS' AND c.status='CONNECTED'
 ORDER BY pc.tenant_id,pc.property_id LIMIT LEAST(GREATEST(maximum_rows,1),1000)
$$;
REVOKE ALL ON FUNCTION clock_sync_properties(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clock_sync_properties(INTEGER) TO must_booking_app;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pms_source_updated_at TIMESTAMPTZ;

ALTER TABLE clock_sync_jobs ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
