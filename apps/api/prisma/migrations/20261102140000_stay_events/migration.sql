-- Real arrival and departure of a stay: when it happened, who recorded it, and a history of every step.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS booking_stay_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  booking_id UUID NOT NULL,
  from_status VARCHAR(20) NOT NULL CHECK (from_status IN ('expected','checked_in','checked_out','no_show')),
  to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('expected','checked_in','checked_out','no_show')),
  occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id UUID,
  early_departure BOOLEAN NOT NULL DEFAULT false,
  balance_overridden BOOLEAN NOT NULL DEFAULT false,
  note VARCHAR(500),
  FOREIGN KEY (tenant_id, property_id, booking_id) REFERENCES bookings(tenant_id, property_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS booking_stay_events_booking ON booking_stay_events(tenant_id, property_id, booking_id, occurred_at);

ALTER TABLE booking_stay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_stay_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_stay_events_read ON booking_stay_events;
CREATE POLICY booking_stay_events_read ON booking_stay_events FOR SELECT
  USING (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()));
DROP POLICY IF EXISTS booking_stay_events_insert ON booking_stay_events;
CREATE POLICY booking_stay_events_insert ON booking_stay_events FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()));
-- Append-only: history is never edited or removed by the application role.
REVOKE UPDATE, DELETE ON booking_stay_events FROM must_booking_app;
GRANT SELECT, INSERT ON booking_stay_events TO must_booking_app;
