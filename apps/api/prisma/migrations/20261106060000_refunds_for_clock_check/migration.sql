-- The nightly check that gateway refunds reached Clock reads across hotels, like the other sweeps, so it uses a
-- narrow definer function. It lists REFUNDED gateway refunds (PokPay/Stripe) of the last days on bookings that
-- exist in Clock, leaving out bookings that already have an open "not found in Clock" review item so a missing
-- refund is raised once, not every night.
-- Additive only. Rollback: DROP FUNCTION "payment_refunds_for_clock_check"(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION "payment_refunds_for_clock_check"(look_back_days INTEGER DEFAULT 45, maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE (
  "tenantId" UUID, "propertyId" UUID, "bookingId" UUID, "refundExternalPaymentId" TEXT, "amount" TEXT, "currency" TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.tenant_id, p.property_id, p.booking_id, p.external_payment_id::text, p.amount::text, p.currency::text
  FROM payments p
  JOIN bookings b ON b.tenant_id = p.tenant_id AND b.property_id = p.property_id AND b.id = p.booking_id
  WHERE p.kind = 'REFUND' AND p.status = 'REFUNDED' AND p.provider IN ('pokpay', 'stripe')
    AND b.external_booking_id IS NOT NULL
    AND p.created_at >= now() - make_interval(days => LEAST(GREATEST(look_back_days, 1), 365))
    AND NOT EXISTS (
      SELECT 1 FROM manual_review_items m
      WHERE m.tenant_id = p.tenant_id AND m.property_id = p.property_id AND m.status = 'OPEN'
        AND m.reference_id = p.booking_id::text
        AND m.message LIKE 'A refund recorded here was not found in Clock%'
    )
  ORDER BY p.created_at DESC, p.id
  LIMIT LEAST(GREATEST(maximum_rows, 1), 500)
$$;
REVOKE ALL ON FUNCTION "payment_refunds_for_clock_check"(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_refunds_for_clock_check"(INTEGER, INTEGER) TO must_booking_app;
