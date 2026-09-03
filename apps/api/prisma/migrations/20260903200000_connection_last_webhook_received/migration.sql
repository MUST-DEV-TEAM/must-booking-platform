-- Clock certification gap (Task B, docs/CLOCK_CERTIFICATION_GAPS_PLAN.md):
-- missing-webhook alerting needs to know when a connection last actually
-- heard from Clock. Nullable, no backfill needed — a connection with no
-- value yet is treated as "not stale until createdAt + threshold has passed"
-- by ClockWebhookHealthService, not "already stale."
ALTER TABLE "integration_connections"
  ADD COLUMN IF NOT EXISTS "last_webhook_received_at" TIMESTAMPTZ(6);
