-- Settings redesign, Overview: "Hide for now" on the setup guide and the one-time "ready to take bookings"
-- notice are remembered per person and per hotel (they were kept in one browser only).
--
-- Additive only. Rollback (nothing refers to this table):
--   DROP TABLE IF EXISTS settings_overview_dismissals;

CREATE TABLE IF NOT EXISTS settings_overview_dismissals (
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('SETUP_GUIDE', 'READY_NOTICE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id, user_id, kind),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE settings_overview_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_overview_dismissals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON settings_overview_dismissals;
CREATE POLICY tenant_scope ON settings_overview_dismissals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON settings_overview_dismissals TO must_booking_app;
