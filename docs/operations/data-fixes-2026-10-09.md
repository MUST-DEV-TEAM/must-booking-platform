# One-off live data fixes (2026-10-09)

Kept for the record: three SQL scripts that were run by hand on the live database on 2026-10-09 to repair the refund ledger of one booking (`EBR-260930-2258-9WDC`, Milestone 21 Task 29). They are **not** migrations and must not be run again as they are. Each write script checks its own preconditions and stops if the data is not exactly what it expects, and each is safe to run twice.

## What happened

PokPay refunded 250.00 EUR in total on that booking, but the ledger had recorded only 50.00: a second staff refund of 2026-10-01 was refunded by PokPay and then dropped by the ledger. Two review items (the 2026-09-30 Clock rate limit and the 2026-10-01 missing negative-payment right) were still open for the same booking. The owner confirmed on 2026-10-09 that the Clock cause was known and handled with Clock.

1. `01` reads the refund ledger (read-only): every booking with refunds, charged against refunded.
2. `02` adds the missing 200.00 EUR refund row and an audit entry.
3. `03` resolves the two open review items, with an audit entry for each.

## 01 - check the refund ledger (read-only)

```sql
-- READ-ONLY. Lists every booking that has refunds, with charged vs refunded totals per booking.
-- Rows where refunded > charged, or the booking 9WDC, deserve a look. Compare with PokPay/Stripe.
SELECT b.external_reference,
       b.status AS booking_status,
       c.provider,
       SUM(p.amount) FILTER (WHERE p.kind = 'CHARGE') AS charged,
       SUM(p.amount) FILTER (WHERE p.kind = 'REFUND') AS refunded,
       COUNT(*) FILTER (WHERE p.kind = 'REFUND') AS refund_rows,
       string_agg(DISTINCT p.status, ',') AS statuses
FROM bookings b
JOIN payments p ON p.tenant_id = b.tenant_id AND p.booking_id = b.id
LEFT JOIN LATERAL (SELECT provider FROM payments x WHERE x.booking_id = b.id AND x.kind = 'CHARGE' LIMIT 1) c ON true
GROUP BY b.external_reference, b.status, c.provider
HAVING COUNT(*) FILTER (WHERE p.kind = 'REFUND') > 0
ORDER BY b.external_reference;

-- Raw rows for the known booking.
SELECT p.kind, p.provider, p.external_payment_id, p.status, p.amount, p.currency, p.note, p.created_at
FROM payments p JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
WHERE b.external_reference = 'EBR-260930-2258-9WDC'
ORDER BY p.created_at;

-- Refunds since Clock granted the negative-payment rights (2026-10-02), and any Clock-sync problems raised for them.
SELECT b.external_reference, p.provider, p.amount, p.created_at
FROM payments p JOIN bookings b ON b.id = p.booking_id AND b.tenant_id = p.tenant_id
WHERE p.kind = 'REFUND' AND p.created_at >= '2026-10-02'
ORDER BY p.created_at;

SELECT created_at, status, category, reference_id, left(message, 300) AS message
FROM manual_review_items
WHERE created_at >= '2026-09-30' AND (message ILIKE '%refund%' OR context::text ILIKE '%refund%')
ORDER BY created_at;
```

## 02 - backfill the missing refund (writes)

```sql
-- WRITES. Adds the missing 200.00 EUR refund for EBR-260930-2258-9WDC (Milestone 21 Task 29).
-- Guarded: aborts unless the booking has exactly one PokPay charge of 250.00 and exactly 50.00
-- already recorded as refunded. Safe to run twice: the second run finds 250.00 refunded and stops.
-- Rollback: DELETE FROM payments WHERE external_payment_id LIKE '%:refund:backfill-task29-200';
--           DELETE FROM audit_logs WHERE action = 'payment.refund_backfilled' AND details->>'task' = 'M21-T29';
BEGIN;
DO $$
DECLARE
  b record; ch record; refunded numeric; n int;
BEGIN
  SELECT id, tenant_id, property_id INTO STRICT b FROM bookings WHERE external_reference = 'EBR-260930-2258-9WDC';
  SELECT count(*) INTO n FROM payments WHERE booking_id = b.id AND kind = 'CHARGE' AND provider = 'pokpay';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 pokpay charge, found %', n; END IF;
  SELECT * INTO ch FROM payments WHERE booking_id = b.id AND kind = 'CHARGE' AND provider = 'pokpay';
  IF ch.amount <> 250.00 OR ch.currency <> 'EUR' THEN RAISE EXCEPTION 'charge is % %, expected 250.00 EUR', ch.amount, ch.currency; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO refunded FROM payments WHERE booking_id = b.id AND kind = 'REFUND';
  IF refunded = 250.00 THEN RAISE NOTICE 'already 250.00 refunded, nothing to do'; RETURN; END IF;
  IF refunded <> 50.00 THEN RAISE EXCEPTION 'refunded is %, expected 50.00', refunded; END IF;

  INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, note)
  VALUES (b.tenant_id, b.property_id, b.id, 'REFUND', 'pokpay',
          split_part(ch.external_payment_id, ':', 1) || ':refund:backfill-task29-200', 'REFUNDED', 200.00, 'EUR',
          'Backfill: second staff refund of 2026-10-01, refunded by PokPay but dropped by the ledger (M21 Task 29)')
  ON CONFLICT (tenant_id, external_payment_id) DO NOTHING;

  INSERT INTO audit_logs (tenant_id, property_id, actor_user_id, actor_type, action, target_type, target_id, details)
  VALUES (b.tenant_id, b.property_id, NULL, 'PLATFORM_ADMIN', 'payment.refund_backfilled', 'booking', b.id::text,
          jsonb_build_object('task', 'M21-T29', 'chargeExternalPaymentId', ch.external_payment_id,
                             'amount', jsonb_build_object('amount', '200.00', 'currency', 'EUR'),
                             'reason', 'PokPay refunded 250.00 in total; ledger had 50.00'));
  RAISE NOTICE 'backfilled 200.00 refund';
END $$;
-- Show the result before committing.
SELECT p.kind, p.external_payment_id, p.status, p.amount FROM payments p
JOIN bookings b ON b.id = p.booking_id WHERE b.external_reference = 'EBR-260930-2258-9WDC' ORDER BY p.created_at;
COMMIT;
```

## 03 - resolve the two review items (writes)

```sql
-- WRITES. Closes the two open refund review items for EBR-260930-2258-9WDC's era
-- (2026-09-30 Clock rate limit, 2026-10-01 missing negative-payment right). Owner said 2026-10-09:
-- the Clock cause is known and handled, the MUST record is backfilled (02). Safe to run twice.
-- Guard: aborts unless it matches exactly 2 OPEN items.
BEGIN;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM manual_review_items
  WHERE status = 'OPEN' AND category = 'PAYMENT_BOOKING_MISMATCH'
    AND created_at >= '2026-09-30' AND created_at < '2026-10-02'
    AND (message ILIKE 'MUST refunded the guest, but Clock''s deposit payment history could not be read%'
         OR message ILIKE 'Clock rejected the negative deposit payment%');
  IF n = 0 THEN RAISE NOTICE 'nothing open, nothing to do'; RETURN; END IF;
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 open items, found %', n; END IF;

  INSERT INTO audit_logs (tenant_id, property_id, actor_user_id, actor_type, action, target_type, target_id, details)
  SELECT tenant_id, property_id, NULL, 'PLATFORM_ADMIN', 'platform.manual_review.resolved', 'manual_review_item', id::text,
         jsonb_build_object('reason', 'Refund ledger backfilled (M21-T29); Clock cause handled with Clock, owner 2026-10-09')
  FROM manual_review_items
  WHERE status = 'OPEN' AND category = 'PAYMENT_BOOKING_MISMATCH'
    AND created_at >= '2026-09-30' AND created_at < '2026-10-02'
    AND (message ILIKE 'MUST refunded the guest, but Clock''s deposit payment history could not be read%'
         OR message ILIKE 'Clock rejected the negative deposit payment%');

  UPDATE manual_review_items SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE status = 'OPEN' AND category = 'PAYMENT_BOOKING_MISMATCH'
    AND created_at >= '2026-09-30' AND created_at < '2026-10-02'
    AND (message ILIKE 'MUST refunded the guest, but Clock''s deposit payment history could not be read%'
         OR message ILIKE 'Clock rejected the negative deposit payment%');
  RAISE NOTICE 'resolved 2 items';
END $$;
SELECT created_at, status, resolved_at, left(message, 80) FROM manual_review_items
WHERE category = 'PAYMENT_BOOKING_MISMATCH' AND created_at >= '2026-09-30' ORDER BY created_at;
COMMIT;
```
