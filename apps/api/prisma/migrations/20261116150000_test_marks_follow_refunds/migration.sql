-- A refund takes the test mark of the charge it refunds (ADR-0041). PokPay refund ids ("<order>:refund:<key>")
-- carry their order id, so they were already marked; Stripe refund ids ("re_...") do not, so every Stripe refund
-- of a test payment was counted as real money. Additive and safe to re-run.
-- Rollback: restore the two functions from migration 20261116145000_test_payment_marks (their bodies are in it);
--           the corrected is_test values are plain data and need no rollback.

-- New ledger rows: a refund is marked from the charge(s) of its booking (same provider); a charge as before.
CREATE OR REPLACE FUNCTION payments_mark_test() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider IN ('pokpay', 'stripe') THEN
    SELECT bool_or(c.mode = 'TEST') INTO NEW.is_test
    FROM payment_provider_sessions s
    JOIN integration_connections c ON c.tenant_id = s.tenant_id AND c.id = s.connection_id
    WHERE s.tenant_id = NEW.tenant_id AND s.provider = NEW.provider
      AND s.external_payment_id = payment_order_id(NEW.external_payment_id);
    -- A refund whose id does not name its order (Stripe's "re_...") follows its booking's charges.
    IF NEW.is_test IS NULL AND NEW.kind = 'REFUND' THEN
      SELECT bool_or(c.is_test) INTO NEW.is_test
      FROM payments c
      WHERE c.tenant_id = NEW.tenant_id AND c.booking_id = NEW.booking_id
        AND c.kind = 'CHARGE' AND c.provider = NEW.provider;
    END IF;
    NEW.is_test := COALESCE(NEW.is_test, false);
  END IF;
  RETURN NEW;
END $$;

-- Re-marking (a connection's mode filled in, an older order's account found) also reaches the refunds.
CREATE OR REPLACE FUNCTION payment_marks_refresh(target_connection UUID, target_session UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE payments p SET is_test = (c.mode = 'TEST')
  FROM payment_provider_sessions s
  JOIN integration_connections c ON c.tenant_id = s.tenant_id AND c.id = s.connection_id
  WHERE (s.connection_id = target_connection OR s.id = target_session)
    AND c.mode IS NOT NULL
    AND p.tenant_id = s.tenant_id AND p.provider = s.provider
    AND payment_order_id(p.external_payment_id) = s.external_payment_id
    AND p.is_test IS DISTINCT FROM (c.mode = 'TEST');
  UPDATE payments r SET is_test = c.is_test
  FROM (
    SELECT tenant_id, booking_id, provider, bool_or(is_test) AS is_test
    FROM payments WHERE kind = 'CHARGE' AND provider IN ('pokpay', 'stripe')
    GROUP BY tenant_id, booking_id, provider
  ) c
  WHERE r.kind = 'REFUND' AND r.tenant_id = c.tenant_id AND r.booking_id = c.booking_id
    AND r.provider = c.provider AND r.is_test IS DISTINCT FROM c.is_test
    AND EXISTS (
      SELECT 1 FROM payment_provider_sessions s
      WHERE s.tenant_id = r.tenant_id AND s.booking_id = r.booking_id AND s.provider = r.provider
        AND (s.connection_id = target_connection OR s.id = target_session)
    );
END $$;
REVOKE ALL ON FUNCTION payment_marks_refresh(UUID, UUID) FROM PUBLIC;

-- Existing refunds follow their charges once.
UPDATE payments r SET is_test = c.is_test
FROM (
  SELECT tenant_id, booking_id, provider, bool_or(is_test) AS is_test
  FROM payments WHERE kind = 'CHARGE' AND provider IN ('pokpay', 'stripe')
  GROUP BY tenant_id, booking_id, provider
) c
WHERE r.kind = 'REFUND' AND r.tenant_id = c.tenant_id AND r.booking_id = c.booking_id
  AND r.provider = c.provider AND r.is_test IS DISTINCT FROM c.is_test;
