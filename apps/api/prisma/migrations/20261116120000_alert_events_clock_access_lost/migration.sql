-- A hotel's owners are emailed (through the existing owner problem alert, if the property has it switched
-- on) when Clock refuses the whole connection, for example an expired trial. Adds one event kind to
-- notification_alert_events(); the rest of the function is unchanged. Additive and idempotent.
-- Roll back by re-running 20261009160000_alert_emails's definition of the function.

CREATE OR REPLACE FUNCTION "notification_alert_events"(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  "tenantId" UUID, "propertyId" UUID, "tenantName" VARCHAR, "propertyName" VARCHAR,
  "kind" TEXT, "itemId" TEXT, "reference" TEXT, "detail" TEXT, "occurredAt" TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e."tenantId", e."propertyId", o.name, p.name, e.kind, e."itemId", e.reference, e.detail, e."occurredAt"
  FROM (
    SELECT b.tenant_id AS "tenantId", b.property_id AS "propertyId", 'booking_attention' AS kind,
      b.id::text AS "itemId", COALESCE(b.order_reference, b.external_reference)::text AS reference,
      b.status::text AS detail, b.updated_at AS "occurredAt"
    FROM bookings b
    WHERE b.status IN ('MANUAL_REVIEW', 'PAYMENT_FAILED', 'AVAILABILITY_FAILED', 'PMS_REJECTED', 'PMS_UNKNOWN_RESULT')
      AND b.updated_at >= p_from AND b.updated_at < p_to
    UNION ALL
    SELECT m.tenant_id, m.property_id, 'clock_review', m.id::text, m.reference_id::text,
      LEFT(m.message, 300), m.created_at
    FROM manual_review_items m
    WHERE m.created_at >= p_from AND m.created_at < p_to
    UNION ALL
    SELECT pe.tenant_id, pe.property_id, 'clock_event_failed', pe.id::text, pe.object_id::text,
      pe.event_type::text, pe.updated_at
    FROM provider_events pe
    WHERE pe.status = 'FAILED' AND pe.updated_at >= p_from AND pe.updated_at < p_to
    UNION ALL
    SELECT pay.tenant_id, pay.property_id, 'refund', pay.id::text,
      COALESCE(b.order_reference, b.external_reference)::text, pay.amount::text || ' ' || pay.currency, pay.created_at
    FROM payments pay
    JOIN bookings b ON b.tenant_id = pay.tenant_id AND b.property_id = pay.property_id AND b.id = pay.booking_id
    WHERE pay.kind = 'REFUND' AND pay.created_at >= p_from AND pay.created_at < p_to
    UNION ALL
    -- Clock refuses the whole connection (expired trial, disabled API user): one event per
    -- in-app notification, which the permissions monitor writes once when access is lost.
    SELECT n.tenant_id, n.property_id, 'clock_access_lost', n.id::text, NULL,
      LEFT(n.payload ->> 'reason', 200), n.created_at
    FROM notifications n
    WHERE n.type = 'CLOCK_ACCESS_LOST' AND n.created_at >= p_from AND n.created_at < p_to
    UNION ALL
    SELECT org.id, NULL, 'new_hotel', org.id::text, NULL, NULL, org.created_at
    FROM organizations org
    WHERE org.created_at >= p_from AND org.created_at < p_to
    UNION ALL
    -- Alerts about the alert emails themselves are left out, so a broken alert
    -- address can't keep alerting about itself.
    SELECT em.tenant_id, em.property_id, 'email_failed', em.id::text, em.event_type::text,
      em.status::text || COALESCE(': ' || LEFT(em.last_error, 200), ''), em.updated_at
    FROM email_messages em
    WHERE em.status IN ('FAILED', 'BOUNCED', 'COMPLAINED') AND em.event_type NOT LIKE 'platform.%'
      AND em.updated_at >= p_from AND em.updated_at < p_to
  ) e
  LEFT JOIN organizations o ON o.id = e."tenantId"
  LEFT JOIN properties p ON p.tenant_id = e."tenantId" AND p.id = e."propertyId"
  ORDER BY e."occurredAt", e."itemId"
$$;
REVOKE ALL ON FUNCTION "notification_alert_events"(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "notification_alert_events"(TIMESTAMPTZ, TIMESTAMPTZ) TO must_booking_app;
