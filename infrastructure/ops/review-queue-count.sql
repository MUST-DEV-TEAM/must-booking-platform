-- Review queue: how many OPEN items the clean-up (M39 task 6, step 3) would close, and why.
-- COUNT ONLY. Read-only: it runs inside a READ ONLY transaction and changes nothing.
-- Output has no guest data: hotel name, category, reason and counts.
--
-- Run on the host (the owner reviews the numbers before step 3):
--   docker exec -i <postgres container> psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     < infrastructure/ops/review-queue-count.sql
--
-- Reasons, first match wins:
--   cancelled_booking  an UNKNOWN_RESULT item ("no valid currency") whose booking is CANCELLED
--   zero_total         an UNKNOWN_RESULT item whose booking has a total of 0
--   duplicate          an older OPEN item exists for the same thing (the oldest is kept)
--   stays_open         none of the above: a person still has to look at it
-- Only UNKNOWN_RESULT items follow the first two rules. Other categories on a cancelled booking (a refund
-- not confirmed, a Deposit Adjustment to issue, a Clock bill still open) are real work and stay open.
-- An item is linked to its booking by reference_type 'booking' (booking id) or 'clock_booking'
-- (Clock's booking id). Items about anything else (provider events, payments) cannot be linked and
-- count as stays_open (or duplicate, when an older identical item exists).

BEGIN READ ONLY;

WITH open_items AS (
  SELECT m.id, m.tenant_id, m.property_id, m.category::text AS category, m.created_at,
         m.reference_type, m.reference_id, COALESCE(m.context ->> 'kind', '') AS kind
  FROM manual_review_items m
  WHERE m.status = 'OPEN'
),
linked AS (
  SELECT o.*, b.status::text AS booking_status, b.total_amount,
         row_number() OVER (
           PARTITION BY o.tenant_id, o.property_id, o.category, o.kind, o.reference_type, o.reference_id
           ORDER BY o.created_at, o.id
         ) AS nth
  FROM open_items o
  LEFT JOIN bookings b
    ON b.tenant_id = o.tenant_id AND b.property_id = o.property_id
   AND ((o.reference_type = 'booking' AND b.id::text = o.reference_id)
     OR (o.reference_type = 'clock_booking' AND b.external_booking_id = o.reference_id))
),
classified AS (
  SELECT l.*,
    CASE
      WHEN l.category = 'UNKNOWN_RESULT' AND l.booking_status = 'CANCELLED' THEN 'cancelled_booking'
      WHEN l.category = 'UNKNOWN_RESULT' AND l.booking_status IS NOT NULL AND l.total_amount = 0 THEN 'zero_total'
      WHEN l.reference_id IS NOT NULL AND l.nth > 1 THEN 'duplicate'
      ELSE 'stays_open'
    END AS reason
  FROM linked l
)
SELECT COALESCE(p.name, c.property_id::text) AS hotel, c.category, c.reason, count(*) AS items
FROM classified c
LEFT JOIN properties p ON p.tenant_id = c.tenant_id AND p.id = c.property_id
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- Totals per hotel.
WITH open_items AS (
  SELECT m.tenant_id, m.property_id FROM manual_review_items m WHERE m.status = 'OPEN'
)
SELECT COALESCE(p.name, o.property_id::text) AS hotel, count(*) AS open_items
FROM open_items o
LEFT JOIN properties p ON p.tenant_id = o.tenant_id AND p.id = o.property_id
GROUP BY 1 ORDER BY 1;

ROLLBACK;
