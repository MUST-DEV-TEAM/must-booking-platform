-- Payment links that staff emailed to a guest, that are still unpaid and still valid, and that were sent at
-- least the hotel's chosen number of days ago (default 3). One row per booking: its newest link. Same
-- privileged candidate discovery boundary as the other sweeps; sending the email stays tenant RLS scoped.
CREATE OR REPLACE FUNCTION payment_link_reminder_candidates(maximum_rows INTEGER DEFAULT 100)
RETURNS TABLE ("bookingId" UUID, "tenantId" UUID, "propertyId" UUID, "operationId" UUID,
               "checkoutUrl" TEXT, "amount" TEXT, "currency" TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT ON (op.aggregate_id)
   b.id, b.tenant_id, b.property_id, op.id, op.result->>'checkoutUrl', op.result->>'amount', op.result->>'currency'
 FROM integration_operations op
 JOIN bookings b ON b.tenant_id=op.tenant_id AND b.property_id=op.property_id AND b.id=op.aggregate_id
 LEFT JOIN notification_topic_settings s
   ON s.tenant_id=b.tenant_id AND s.property_id=b.property_id AND s.topic='payment_reminder'
 LEFT JOIN clock_sync_jobs j
   ON j.tenant_id=b.tenant_id AND j.property_id=b.property_id AND j.resource='financial:'||b.id::text
 WHERE op.result->>'kind'='balance_collection' AND op.result->>'stage'='READY'
   AND op.result->>'checkoutUrl' IS NOT NULL
   AND (op.result->>'expiresAt')::timestamptz > now()
   AND b.status='CONFIRMED'::"BookingStatus"
   AND COALESCE(s.guest_enabled, true)
   AND EXISTS (
     SELECT 1 FROM email_messages m
     WHERE m.tenant_id=b.tenant_id AND m.booking_id=b.id AND m.event_type='payment.link'
       AND m.created_at >= op.created_at
       AND m.created_at <= now() - COALESCE(s.days_offset, 3) * interval '1 day')
   AND CASE
     WHEN b.external_booking_id IS NOT NULL AND b.external_reference LIKE 'CLOCK-%'
       THEN COALESCE((j.snapshot#>>'{balance,amount}')::numeric, 0) > 0
     ELSE b.total_amount > COALESCE((
       SELECT sum(a.amount) FROM payments a
       WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id
         AND a.kind='CHARGE' AND a.status IN ('PAID','succeeded')), 0)
   END
 ORDER BY op.aggregate_id, op.created_at DESC
 LIMIT GREATEST(maximum_rows, 1)
$$;
REVOKE ALL ON FUNCTION payment_link_reminder_candidates(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_link_reminder_candidates(INTEGER) TO must_booking_app;
