-- Email plan Step 2b: instant problem alerts for property owners and the system
-- owner, plus the system owner's daily platform summary. Additive.
--
-- The two new owner emails (problem alerts, refund made) start switched OFF for every
-- property that already exists, like the Step 2a emails; properties created later get
-- the defaults (on). refund_processed had no staff email until now, so switching its
-- staff side off here overrides no choice anyone made.

INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "staff_enabled")
SELECT "tenant_id", "id", 'owner_alerts', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO NOTHING;
INSERT INTO "notification_topic_settings" ("tenant_id", "property_id", "topic", "staff_enabled")
SELECT "tenant_id", "id", 'refund_processed', FALSE FROM "properties"
ON CONFLICT ("tenant_id", "property_id", "topic") DO UPDATE SET "staff_enabled" = FALSE;

-- Everything worth an instant alert that happened in [p_from, p_to), across all
-- hotels. The alert sweep runs without a tenant, and RLS hides other tenants from the
-- app role, so this definer function returns only what the alert emails show.
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

-- Platform-wide numbers for one calendar day in a time zone (system owner's summary).
CREATE OR REPLACE FUNCTION "platform_daily_stats"(p_day DATE, p_timezone TEXT)
RETURNS TABLE (
  "hotels" INT, "properties" INT, "newHotels" INT, "bookings" INT, "cancellations" INT,
  "emailsSent" INT, "emailsFailed" INT, "openReviews" INT, "clockEventsFailed" INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM organizations)::int,
    (SELECT COUNT(*) FROM properties)::int,
    (SELECT COUNT(*) FROM organizations WHERE (created_at AT TIME ZONE p_timezone)::date = p_day)::int,
    (SELECT COUNT(*) FROM bookings WHERE status = 'CONFIRMED' AND external_reference NOT LIKE 'CLOCK-%'
      AND (created_at AT TIME ZONE p_timezone)::date = p_day)::int,
    (SELECT COUNT(*) FROM bookings WHERE status = 'CANCELLED'
      AND (updated_at AT TIME ZONE p_timezone)::date = p_day)::int,
    (SELECT COUNT(*) FROM email_messages WHERE status IN ('SENT', 'DELIVERED')
      AND (created_at AT TIME ZONE p_timezone)::date = p_day)::int,
    (SELECT COUNT(*) FROM email_messages WHERE status IN ('FAILED', 'BOUNCED', 'COMPLAINED')
      AND (updated_at AT TIME ZONE p_timezone)::date = p_day)::int,
    (SELECT COUNT(*) FROM manual_review_items WHERE status = 'OPEN')::int,
    (SELECT COUNT(*) FROM provider_events WHERE status = 'FAILED'
      AND (updated_at AT TIME ZONE p_timezone)::date = p_day)::int
$$;
REVOKE ALL ON FUNCTION "platform_daily_stats"(DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "platform_daily_stats"(DATE, TEXT) TO must_booking_app;
