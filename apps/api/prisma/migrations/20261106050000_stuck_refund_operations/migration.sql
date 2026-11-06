-- The refund recovery sweeper reads across hotels, like the minute sweep and the nightly PokPay check do, so it
-- uses a narrow definer function instead of widening any table access. It lists refund attempts that were saved
-- before the payment provider was called and never finished: the attempt is not marked RETURNED, or it is but no
-- matching REFUND payment exists. The age filter keeps it away from a refund that is still running.
-- Additive only. Rollback: DROP FUNCTION "payment_stuck_refund_operations"(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION "payment_stuck_refund_operations"(min_age_minutes INTEGER DEFAULT 5, maximum_rows INTEGER DEFAULT 50)
RETURNS TABLE (
  "tenantId" UUID, "propertyId" UUID, "bookingId" UUID, "operationId" UUID, "idempotencyKey" TEXT,
  "stage" TEXT, "chargeExternalPaymentId" TEXT, "amount" TEXT, "currency" TEXT, "ageMinutes" INTEGER
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT op.tenant_id, op.property_id, op.aggregate_id, op.id, op.idempotency_key::text,
    COALESCE(op.result->>'stage', 'PREPARING'), op.result->>'chargeExternalPaymentId',
    op.result#>>'{amount,amount}', op.result#>>'{amount,currency}',
    FLOOR(EXTRACT(EPOCH FROM (now() - op.created_at)) / 60)::int
  FROM integration_operations op
  WHERE op.result->>'kind' = 'gateway_refund' AND op.aggregate_id IS NOT NULL
    AND op.created_at <= now() - make_interval(mins => GREATEST(min_age_minutes, 0))
    AND (
      op.result->>'stage' IS DISTINCT FROM 'RETURNED'
      OR NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.tenant_id = op.tenant_id AND p.property_id = op.property_id AND p.booking_id = op.aggregate_id
          AND p.kind = 'REFUND' AND p.status = 'REFUNDED'
          AND p.external_payment_id = op.result#>>'{providerResult,value,id}'
      )
    )
  ORDER BY op.created_at, op.id
  LIMIT LEAST(GREATEST(maximum_rows, 1), 200)
$$;
REVOKE ALL ON FUNCTION "payment_stuck_refund_operations"(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "payment_stuck_refund_operations"(INTEGER, INTEGER) TO must_booking_app;
