ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "stripe_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pokpay_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pay_at_hotel_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the implicit Stripe/pay-at-hotel behavior for properties that existed
-- before gateway configuration was introduced. New properties retain the defaults above.
UPDATE "properties"
SET "stripe_enabled" = true,
    "pay_at_hotel_enabled" = true
WHERE NOT "stripe_enabled"
  AND NOT "pay_at_hotel_enabled"
  AND NOT "pokpay_enabled";
