-- The nightly check of PokPay against our payment records reads across hotels, like the minute sweep does, so it
-- uses a narrow definer function instead of widening any table access. It returns PokPay orders of the last days
-- with what we recorded for them: the charge, and the refunds tied to the same order (their ids start with the
-- order id and ':refund:').
-- Additive only. Rollback: DROP FUNCTION "payment_pokpay_reconciliation_candidates"(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION "payment_pokpay_reconciliation_candidates"(look_back_days INTEGER DEFAULT 45, maximum_rows INTEGER DEFAULT 500)
RETURNS TABLE (
  "tenantId" UUID, "propertyId" UUID, "bookingId" UUID, "orderId" TEXT,
  "chargeStatus" TEXT, "chargeAmount" TEXT, "chargeCurrency" TEXT,
  "refundedAmount" TEXT, "refundCurrencies" TEXT[], "refundCount" INTEGER
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.tenant_id, s.property_id, s.booking_id, s.external_payment_id,
    c.status, c.amount::text, c.currency,
    COALESCE(r.total, 0)::text, COALESCE(r.currencies, ARRAY[]::text[]), COALESCE(r.count, 0)::int
  FROM payment_provider_sessions s
  LEFT JOIN payments c ON c.tenant_id = s.tenant_id AND c.external_payment_id = s.external_payment_id AND c.kind = 'CHARGE'
  LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS total, array_agg(DISTINCT p.currency) AS currencies, COUNT(*) AS count
    FROM payments p
    WHERE p.tenant_id = s.tenant_id AND p.booking_id = s.booking_id AND p.kind = 'REFUND' AND p.provider = 'pokpay'
      AND p.external_payment_id LIKE s.external_payment_id || ':refund:%'
  ) r ON TRUE
  WHERE s.provider = 'pokpay' AND s.created_at >= now() - make_interval(days => LEAST(GREATEST(look_back_days, 1), 365))
  ORDER BY s.created_at DESC, s.id
  LIMIT LEAST(GREATEST(maximum_rows, 1), 1000)
$$;
REVOKE ALL ON FUNCTION "payment_pokpay_reconciliation_candidates"(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_pokpay_reconciliation_candidates"(INTEGER, INTEGER) TO must_booking_app;
