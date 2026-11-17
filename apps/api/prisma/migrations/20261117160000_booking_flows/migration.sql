-- ADR-0043 (saved steps), first use: Milestone 40 slice 40-3b, a PokPay payment that arrives after the booking
-- stopped awaiting payment is refunded automatically through a saved, resumable flow.
--
-- booking_flows: one row per flow run, with the step it reached, a lease so only one runner works on it at a
-- time, and the retry schedule. booking_flow_events: an append-only step history (never updated or deleted).
-- booking_flows_due(): the narrow definer function the worker uses to find due flows across hotels, the same
-- pattern as payment_refunds_for_clock_check.
--
-- Additive only. Rollback (no other table refers to these):
--   DROP FUNCTION IF EXISTS booking_flows_due(integer);
--   DROP TABLE IF EXISTS booking_flow_events; DROP TABLE IF EXISTS booking_flows;

CREATE TABLE IF NOT EXISTS booking_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('LATE_PAYMENT')),
  definition_version integer NOT NULL DEFAULT 1 CHECK (definition_version > 0),
  -- A key that makes starting the same flow twice impossible (for a late payment: the provider order id).
  trigger_key text NOT NULL,
  state text NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'NEEDS_PERSON', 'DONE')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  person_told_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, kind, trigger_key),
  FOREIGN KEY (tenant_id, property_id, booking_id) REFERENCES bookings (tenant_id, property_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS booking_flows_due_idx ON booking_flows (next_run_at) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS booking_flows_booking_idx ON booking_flows (tenant_id, property_id, booking_id);

CREATE TABLE IF NOT EXISTS booking_flow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  flow_id uuid NOT NULL REFERENCES booking_flows (id) ON DELETE RESTRICT,
  step text NOT NULL,
  attempt integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('STARTED', 'DONE', 'RETRY', 'NEEDS_PERSON')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_flow_events_flow_idx ON booking_flow_events (flow_id, created_at);

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['booking_flows', 'booking_flow_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK(tenant_id=current_setting(''app.tenant_id'',true)::uuid)', tbl);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON booking_flows TO must_booking_app;
GRANT SELECT, INSERT ON booking_flow_events TO must_booking_app;
REVOKE UPDATE, DELETE ON booking_flow_events FROM must_booking_app;

CREATE OR REPLACE FUNCTION booking_flows_due(maximum_rows integer DEFAULT 50)
RETURNS TABLE ("tenantId" uuid, "propertyId" uuid, "flowId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.tenant_id, f.property_id, f.id
  FROM booking_flows f
  WHERE f.status = 'RUNNING' AND f.next_run_at <= now()
    AND (f.lease_until IS NULL OR f.lease_until < now())
  ORDER BY f.next_run_at, f.id
  LIMIT LEAST(GREATEST(maximum_rows, 1), 500)
$$;
REVOKE ALL ON FUNCTION booking_flows_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION booking_flows_due(integer) TO must_booking_app;
