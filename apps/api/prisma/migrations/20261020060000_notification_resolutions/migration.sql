-- Shared "resolved" marker for needs-action notifications; read state stays per user.
-- Reopening deletes the row; the audit log keeps the history.
CREATE TABLE IF NOT EXISTS notification_resolutions (
 tenant_id uuid NOT NULL, property_id uuid NOT NULL, notification_id uuid NOT NULL,
 resolved_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 resolved_at timestamptz NOT NULL DEFAULT now(),
 note varchar(1000),
 PRIMARY KEY(tenant_id,property_id,notification_id),
 FOREIGN KEY(tenant_id,property_id,notification_id) REFERENCES notifications(tenant_id,property_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE notification_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_resolutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exact_scope ON notification_resolutions;
CREATE POLICY exact_scope ON notification_resolutions
 USING(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id())
 WITH CHECK(tenant_id=app_current_tenant_id() AND property_id=app_current_property_id());
-- Rollback after reverting the application: DROP TABLE notification_resolutions (export first if needed).
