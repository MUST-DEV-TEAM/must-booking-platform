-- Test payments are labelled, not kept apart (ADR-0041, owner 2026-11-12). A payment taken through a
-- provider test account (PokPay staging) is marked `is_test`; it otherwise behaves like a real one.
-- `integration_connections.mode` is a plain copy of the mode the connection's own (encrypted) keys give it;
-- the API fills it for new connections and for older ones when it starts. Additive and safe to re-run.
-- Rollback: DROP TRIGGER IF EXISTS payments_mark_test ON payments;
--           DROP TRIGGER IF EXISTS integration_connections_mode_marks_payments ON integration_connections;
--           DROP TRIGGER IF EXISTS payment_provider_sessions_connection_marks_payments ON payment_provider_sessions;
--           DROP FUNCTION IF EXISTS payments_mark_test(), payments_follow_connection_mode(), payments_follow_session_connection(), payment_order_id(text), payment_marks_refresh(uuid, uuid);
--           ALTER TABLE payments DROP COLUMN IF EXISTS is_test; ALTER TABLE integration_connections DROP COLUMN IF EXISTS mode;
ALTER TABLE "integration_connections" ADD COLUMN IF NOT EXISTS "mode" VARCHAR(4);
ALTER TABLE "integration_connections" DROP CONSTRAINT IF EXISTS "integration_connections_mode_check";
ALTER TABLE "integration_connections"
  ADD CONSTRAINT "integration_connections_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('TEST', 'LIVE'));

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "is_test" BOOLEAN NOT NULL DEFAULT false;

-- The provider order a ledger row belongs to: a charge's own id, or the charge id before ":refund:".
CREATE OR REPLACE FUNCTION payment_order_id(external_id TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(external_id, ':refund:', 1) $$;

-- New ledger rows take the mode of the account that created their order.
CREATE OR REPLACE FUNCTION payments_mark_test() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider IN ('pokpay', 'stripe') THEN
    SELECT bool_or(c.mode = 'TEST') INTO NEW.is_test
    FROM payment_provider_sessions s
    JOIN integration_connections c ON c.tenant_id = s.tenant_id AND c.id = s.connection_id
    WHERE s.tenant_id = NEW.tenant_id AND s.provider = NEW.provider
      AND s.external_payment_id = payment_order_id(NEW.external_payment_id);
    NEW.is_test := COALESCE(NEW.is_test, false);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_mark_test ON payments;
CREATE TRIGGER payments_mark_test BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_mark_test();

-- Re-marks the ledger rows of one connection's orders (or of one session's order) from the connection's mode.
CREATE OR REPLACE FUNCTION payment_marks_refresh(target_connection UUID, target_session UUID) RETURNS void
LANGUAGE sql AS $$
  UPDATE payments p SET is_test = (c.mode = 'TEST')
  FROM payment_provider_sessions s
  JOIN integration_connections c ON c.tenant_id = s.tenant_id AND c.id = s.connection_id
  WHERE (s.connection_id = target_connection OR s.id = target_session)
    AND c.mode IS NOT NULL
    AND p.tenant_id = s.tenant_id AND p.provider = s.provider
    AND payment_order_id(p.external_payment_id) = s.external_payment_id
    AND p.is_test IS DISTINCT FROM (c.mode = 'TEST')
$$;

-- When a connection's mode is filled in, its earlier payments get the matching mark.
CREATE OR REPLACE FUNCTION payments_follow_connection_mode() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM payment_marks_refresh(NEW.id, NULL);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS integration_connections_mode_marks_payments ON integration_connections;
CREATE TRIGGER integration_connections_mode_marks_payments
  AFTER UPDATE OF "mode" ON integration_connections
  FOR EACH ROW WHEN (NEW.mode IS DISTINCT FROM OLD.mode)
  EXECUTE FUNCTION payments_follow_connection_mode();

-- When an older session learns its connection, that order's payments get the matching mark.
CREATE OR REPLACE FUNCTION payments_follow_session_connection() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM payment_marks_refresh(NULL, NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS payment_provider_sessions_connection_marks_payments ON payment_provider_sessions;
CREATE TRIGGER payment_provider_sessions_connection_marks_payments
  AFTER UPDATE OF "connection_id" ON payment_provider_sessions
  FOR EACH ROW WHEN (NEW.connection_id IS DISTINCT FROM OLD.connection_id)
  EXECUTE FUNCTION payments_follow_session_connection();
