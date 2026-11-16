-- Review queue clean-up for ONE hotel (M39 task 6, step 3). Changes live rows: run only with the owner's go.
--
--   psql ... -v hotel="'Must Hotel'" -v finish=ROLLBACK < review-queue-cleanup.sql   (dry run: shows the counts)
--   psql ... -v hotel="'Must Hotel'" -v finish=COMMIT   < review-queue-cleanup.sql   (does it)
--
-- 1. Marks OPEN items RESOLVED, with the reason and the previous status kept in `context`:
--      cancelled_booking / zero_total   an UNKNOWN_RESULT ("no valid currency") item on a cancelled or zero-total booking
--      duplicate                        an older OPEN item with the same message exists for the same thing
--    Nothing else is closed. Rows are never deleted. Undo: set status back to context->>'previousStatus' for rows
--    whose context->>'cleanup' = 'M39-6d'.
-- 2. Gives the remaining OPEN items a dedupe_key (the oldest per key; a second item with a different message for
--    the same key keeps no key, so the unique index in the next migration can be built).
--    The key is the one ManualReviewService builds: category:kind:reference_type:reference_id[:operationKey].

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE cleanup_plan ON COMMIT DROP AS
WITH open_items AS (
  SELECT m.id, m.tenant_id, m.property_id, m.category::text AS category, m.created_at, m.message,
         m.reference_type, m.reference_id, COALESCE(m.context ->> 'kind', '') AS kind
  FROM manual_review_items m
  JOIN properties p ON p.tenant_id = m.tenant_id AND p.id = m.property_id
  WHERE m.status = 'OPEN' AND p.name = :hotel
),
linked AS (
  SELECT o.*, b.status::text AS booking_status, b.total_amount,
         row_number() OVER (PARTITION BY o.tenant_id, o.property_id, o.category, o.kind, o.reference_type,
                            o.reference_id, o.message ORDER BY o.created_at, o.id) AS nth
  FROM open_items o
  LEFT JOIN bookings b
    ON b.tenant_id = o.tenant_id AND b.property_id = o.property_id
   AND ((o.reference_type = 'booking' AND b.id::text = o.reference_id)
     OR (o.reference_type = 'clock_booking' AND b.external_booking_id = o.reference_id))
)
SELECT l.id, l.tenant_id, l.property_id,
  CASE
    WHEN l.category = 'UNKNOWN_RESULT' AND l.booking_status = 'CANCELLED' THEN 'cancelled_booking'
    WHEN l.category = 'UNKNOWN_RESULT' AND l.booking_status IS NOT NULL AND l.total_amount = 0 THEN 'zero_total'
    WHEN l.reference_id IS NOT NULL AND l.nth > 1 THEN 'duplicate'
  END AS reason
FROM linked l;

SELECT COALESCE(reason, 'stays_open') AS reason, count(*) AS items FROM cleanup_plan GROUP BY 1 ORDER BY 1;

UPDATE manual_review_items m
SET status = 'RESOLVED', resolved_at = now(), updated_at = now(),
    context = COALESCE(m.context, '{}'::jsonb) || jsonb_build_object(
      'cleanup', 'M39-6d', 'previousStatus', 'OPEN',
      'resolution', CASE c.reason
        WHEN 'duplicate' THEN 'Closed by clean-up: an older open item says the same thing.'
        WHEN 'cancelled_booking' THEN 'Closed by clean-up: the reservation is cancelled, so the currency note needs no action.'
        ELSE 'Closed by clean-up: the reservation has a zero total, so the currency note needs no action.' END)
FROM cleanup_plan c
WHERE m.id = c.id AND m.tenant_id = c.tenant_id AND c.reason IS NOT NULL AND m.status = 'OPEN';

-- Keys for what stays open (the oldest item per key only).
WITH keyed AS (
  SELECT m.id,
         m.category::text || ':' || COALESCE(m.context ->> 'kind', '') || ':' || m.reference_type || ':' || m.reference_id
           || CASE WHEN COALESCE(m.context ->> 'operationKey', '') <> '' THEN ':' || (m.context ->> 'operationKey') ELSE '' END AS key,
         row_number() OVER (PARTITION BY m.tenant_id, m.property_id, m.category, COALESCE(m.context ->> 'kind', ''),
                            m.reference_type, m.reference_id, COALESCE(m.context ->> 'operationKey', '')
                            ORDER BY m.created_at, m.id) AS nth
  FROM manual_review_items m
  JOIN cleanup_plan c ON c.id = m.id AND c.tenant_id = m.tenant_id
  WHERE m.status = 'OPEN' AND m.dedupe_key IS NULL AND m.reference_id IS NOT NULL
)
UPDATE manual_review_items m SET dedupe_key = k.key, last_seen_at = COALESCE(m.last_seen_at, m.created_at)
FROM keyed k
WHERE m.id = k.id AND k.nth = 1
  AND NOT EXISTS (SELECT 1 FROM manual_review_items x
                  WHERE x.tenant_id = m.tenant_id AND x.property_id = m.property_id
                    AND x.status = 'OPEN' AND x.dedupe_key = k.key);

SELECT status::text, count(*) AS items, count(dedupe_key) AS with_key
FROM manual_review_items m JOIN properties p ON p.tenant_id = m.tenant_id AND p.id = m.property_id
WHERE p.name = :hotel GROUP BY 1 ORDER BY 1;

:finish;
