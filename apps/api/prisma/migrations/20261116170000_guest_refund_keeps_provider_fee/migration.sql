-- A guest who decides to cancel bears the payment provider's fee (owner, 2026-11-16): the hotel can keep the
-- fee back from a guest-requested refund (ADR-0042). Off until the hotel turns it on, because the hotel's terms
-- must say so first. `provider_fee_*` caches the fee the provider charged for one payment session, read once
-- from the provider. Additive and safe to re-run.
-- Rollback: ALTER TABLE properties DROP COLUMN IF EXISTS deduct_payment_fee_on_guest_refund;
--           ALTER TABLE payment_provider_sessions DROP COLUMN IF EXISTS provider_fee_amount, DROP COLUMN IF EXISTS provider_fee_currency;
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "deduct_payment_fee_on_guest_refund" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payment_provider_sessions"
  ADD COLUMN IF NOT EXISTS "provider_fee_amount" NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS "provider_fee_currency" VARCHAR(3);
