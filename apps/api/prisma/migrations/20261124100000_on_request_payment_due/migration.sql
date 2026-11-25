-- Additive and re-runnable. Rollback: stop new on-request bookings, resolve pending
-- requests and payment holds, then restore the previous application and candidate function
-- and expiring-candidate functions from 20261123161100_on_request_sweep, drop
-- on_request_payment_reminder_candidates(integer), restore payment_pending_pokpay_candidates
-- from 20261109180000_stop_polling_expired_balance_links, and retain this column.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;

CREATE OR REPLACE FUNCTION payment_pending_expiry_candidates(cutoff_at timestamptz, maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.tenant_id,b.property_id FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus"
   AND COALESCE(b.payment_due_at, COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute') <= cutoff_at + interval '30 minutes'
 ORDER BY COALESCE(b.payment_due_at, COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute'),b.id
 LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiry_candidates(timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiry_candidates(timestamptz,integer) TO must_booking_app;

CREATE OR REPLACE FUNCTION payment_pending_expiring_candidates(window_minutes integer, maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid,"expiresAt" timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT ON (b.tenant_id,b.property_id,COALESCE(b.order_reference,b.id::text))
   b.id,b.tenant_id,b.property_id,COALESCE(b.payment_due_at,COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute')
 FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus"
   AND (b.payment_due_at IS NOT NULL OR b.payment_method='POKPAY'::"BookingPaymentMethod")
   AND (b.payment_due_at IS NOT NULL OR p.online_payment_hold_minutes>window_minutes)
   AND COALESCE(b.payment_due_at,COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute')>now()
   AND COALESCE(b.payment_due_at,COALESCE(b.payment_pending_at,b.created_at) + p.online_payment_hold_minutes * interval '1 minute') - window_minutes * interval '1 minute'<=now()
 ORDER BY b.tenant_id,b.property_id,COALESCE(b.order_reference,b.id::text),b.order_room_number NULLS FIRST,b.id
 LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION payment_pending_expiring_candidates(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_expiring_candidates(integer,integer) TO must_booking_app;

CREATE OR REPLACE FUNCTION on_request_payment_reminder_candidates(maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid,"checkoutUrl" text,"amount" text,"currency" text,"reminder" integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT b.id,b.tenant_id,b.property_id,b.on_request_checkout_url,
   COALESCE((SELECT sum(c.total_amount) FROM bookings c WHERE c.tenant_id=b.tenant_id
     AND c.property_id=b.property_id AND c.order_reference=b.order_reference),b.total_amount)::text,
   rp.currency,v.number
 FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
 JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
 LEFT JOIN notification_topic_settings s ON s.tenant_id=b.tenant_id AND s.property_id=b.property_id AND s.topic='payment_reminder'
 CROSS JOIN LATERAL (VALUES (1,COALESCE(s.days_offset,3)),(2,p.payment_second_reminder_days)) v(number,days)
 WHERE b.status='PAYMENT_PENDING'::"BookingStatus" AND b.payment_due_at>now()
   AND b.on_request_checkout_url IS NOT NULL AND b.payment_pending_at IS NOT NULL
   AND v.days IS NOT NULL AND b.payment_pending_at+v.days*interval '1 day'<=now()
   AND COALESCE(s.guest_enabled,true)
   AND (b.order_room_number IS NULL OR b.order_room_number=1)
   AND NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.tenant_id=b.tenant_id AND m.property_id=b.property_id
     AND m.idempotency_key='request-payment-reminder/'||b.id::text||'/'||v.number::text)
 ORDER BY b.payment_due_at,b.id,v.number LIMIT GREATEST(maximum_rows,1)
$$;
REVOKE ALL ON FUNCTION on_request_payment_reminder_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION on_request_payment_reminder_candidates(integer) TO must_booking_app;

CREATE OR REPLACE FUNCTION payment_pending_pokpay_candidates(maximum_rows integer DEFAULT 100)
RETURNS TABLE ("bookingId" uuid,"tenantId" uuid,"propertyId" uuid,"externalPaymentId" text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.booking_id,s.tenant_id,s.property_id,s.external_payment_id
 FROM payment_provider_sessions s JOIN bookings b ON b.tenant_id=s.tenant_id AND b.property_id=s.property_id AND b.id=s.booking_id
 WHERE s.provider='pokpay' AND (b.status='PAYMENT_PENDING'::"BookingStatus" OR EXISTS(
   SELECT 1 FROM integration_operations o WHERE o.tenant_id=s.tenant_id AND o.property_id=s.property_id
     AND o.aggregate_id=s.booking_id AND o.external_reference=s.external_payment_id
     AND ((o.result->>'kind'='balance_collection' AND o.result->>'stage'='READY' AND o.created_at>now()-interval '8 days')
       OR (o.result->>'kind'='request_checkout' AND b.status IN ('CONFIRMED','EXPIRED','CANCELLED')
         AND (o.result->>'expiresAt')::timestamptz>now()-interval '1 day'
         AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=s.tenant_id AND p.property_id=s.property_id
           AND p.external_payment_id=s.external_payment_id)))))
 ORDER BY s.created_at,s.id LIMIT LEAST(GREATEST(maximum_rows,1),100)
$$;
REVOKE ALL ON FUNCTION payment_pending_pokpay_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_pending_pokpay_candidates(integer) TO must_booking_app;
