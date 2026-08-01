-- Milestone 5, Task 7: explicitly distinguish Stripe Checkout, pay-at-hotel, and free bookings.
DO $$
BEGIN
  CREATE TYPE "BookingPaymentMethod" AS ENUM ('STRIPE_CHECKOUT', 'PAY_AT_HOTEL', 'FREE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "payment_method" "BookingPaymentMethod";

-- Before pay-at-hotel existed, every non-zero booking used Stripe Checkout while zero-total
-- bookings followed the no-payment path. Preserve that meaning for existing records.
UPDATE "bookings"
SET "payment_method" = CASE
  WHEN "total_amount" = 0 THEN 'FREE'::"BookingPaymentMethod"
  ELSE 'STRIPE_CHECKOUT'::"BookingPaymentMethod"
END
WHERE "payment_method" IS NULL;

ALTER TABLE "bookings"
  ALTER COLUMN "payment_method" SET DEFAULT 'STRIPE_CHECKOUT'::"BookingPaymentMethod",
  ALTER COLUMN "payment_method" SET NOT NULL;
