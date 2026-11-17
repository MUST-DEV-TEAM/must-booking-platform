-- Closing the guest's open Stripe page once its booking is cancelled or has expired (M36). `checkout_closed_at`
-- marks a session that was closed (or found already closed) so the sweep does not ask Stripe twice. The function
-- lists, across hotels, the sessions of ended bookings that still need closing (same pattern as
-- payment_pending_expiry_candidates). Only sessions created in the last 24 hours are listed: Stripe closes older
-- pages by itself. Additive and safe to re-run.
-- Rollback: DROP FUNCTION IF EXISTS stripe_checkouts_to_close(INTEGER);
--           ALTER TABLE payment_provider_sessions DROP COLUMN IF EXISTS checkout_closed_at;
ALTER TABLE "payment_provider_sessions" ADD COLUMN IF NOT EXISTS "checkout_closed_at" TIMESTAMPTZ(6);

CREATE OR REPLACE FUNCTION "stripe_checkouts_to_close"(maximum_rows INTEGER)
RETURNS TABLE ("tenantId" UUID, "propertyId" UUID, "bookingId" UUID, "externalPaymentId" TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.tenant_id, s.property_id, s.booking_id, s.external_payment_id::text
  FROM payment_provider_sessions s
  JOIN bookings b
    ON b.tenant_id = s.tenant_id AND b.property_id = s.property_id AND b.id = s.booking_id
  WHERE s.provider = 'stripe'
    AND s.checkout_closed_at IS NULL
    AND b.status IN ('EXPIRED'::"BookingStatus", 'CANCELLED'::"BookingStatus")
    AND s.created_at > now() - interval '24 hours'
  ORDER BY s.created_at
  LIMIT GREATEST(maximum_rows, 1)
$$;

REVOKE ALL ON FUNCTION "stripe_checkouts_to_close"(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "stripe_checkouts_to_close"(INTEGER) TO must_booking_app;
