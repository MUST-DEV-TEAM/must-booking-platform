-- Group requests: a guest whose party is bigger than the hotel's booking limits asks the hotel for a quote
-- (Booking rules, "Show a group request form"). The request is stored, the hotel is emailed and notified.
--
-- Additive only. Rollback (nothing refers to this table):
--   DROP TABLE IF EXISTS group_requests;

CREATE TABLE IF NOT EXISTS group_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ANSWERED', 'CLOSED')),
  guest_name varchar(160) NOT NULL,
  guest_email varchar(254) NOT NULL,
  guest_phone varchar(32),
  organisation varchar(160),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  adults integer NOT NULL CHECK (adults BETWEEN 1 AND 500),
  children integer NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 500),
  rooms integer NOT NULL CHECK (rooms BETWEEN 1 AND 200),
  message varchar(2000),
  language varchar(5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS group_requests_property_created_idx
  ON group_requests (tenant_id, property_id, created_at DESC);

ALTER TABLE group_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON group_requests;
CREATE POLICY tenant_scope ON group_requests
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON group_requests TO must_booking_app;
