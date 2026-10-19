-- Additive personal inbox. Legacy shared read_at is retained, never attributed to a user.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_scope_id ON notifications(tenant_id,property_id,id);
CREATE TABLE IF NOT EXISTS notification_inbox_states (
 tenant_id uuid NOT NULL, property_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 PRIMARY KEY(tenant_id,property_id,user_id),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS notification_reads (
 tenant_id uuid NOT NULL, property_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 notification_id uuid NOT NULL, read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,user_id,notification_id),
 FOREIGN KEY(tenant_id,property_id,notification_id) REFERENCES notifications(tenant_id,property_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS notification_operations (
 tenant_id uuid NOT NULL, property_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key varchar(128) NOT NULL, request_hash varchar(64) NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,property_id,user_id,idempotency_key),
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS notification_operations_retention ON notification_operations(tenant_id,property_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_reads','notification_inbox_states','notification_operations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('DROP POLICY IF EXISTS exact_scope ON %I',t);
 EXECUTE format('CREATE POLICY exact_scope ON %I USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id()) WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())',t);
 END LOOP;
END $$;
