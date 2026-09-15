-- Milestone 21, Task 21: retain each PokPay checkout binding when staff sends
-- a fresh link. An earlier link can still complete and is resolved safely by
-- the existing payment-ledger and booking-state idempotency paths.
--
-- Rollback plan: retain the historical bindings; only re-add the old unique
-- constraint after an explicit data migration has selected or archived one
-- session per (tenant_id, property_id, booking_id, provider).
ALTER TABLE "payment_provider_sessions"
  DROP CONSTRAINT IF EXISTS "payment_provider_sessions_booking_provider_unique";
ALTER TABLE "payment_provider_sessions"
  DROP CONSTRAINT IF EXISTS "payment_provider_sessions_tenant_id_property_id_booking_id_key";
ALTER TABLE "payment_provider_sessions"
  DROP CONSTRAINT IF EXISTS "payment_provider_sessions_tenant_id_property_id_booking_id__key";

CREATE INDEX IF NOT EXISTS "payment_provider_sessions_booking_provider_idx"
  ON "payment_provider_sessions" ("tenant_id", "property_id", "booking_id", "provider");

DROP INDEX IF EXISTS "payment_provider_sessions_tenant_id_property_id_booking_id_idx";
