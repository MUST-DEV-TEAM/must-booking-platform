-- Clock certification gap (Task C, docs/CLOCK_CERTIFICATION_GAPS_PLAN.md):
-- surface Clock folio state on the booking it belongs to. Visibility only —
-- no relation to payments/payment_provider_sessions, no write path back to
-- Clock, no guest-payment/billing code touches these columns.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "clock_folio_id" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "clock_folio_balance" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "clock_folio_closed_at" TIMESTAMPTZ(6);
