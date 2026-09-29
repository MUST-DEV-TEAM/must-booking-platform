-- Milestone 21 remediation, Task "durable Clock webhook processing"
-- (docs/integrations/clock/webhooks-and-reconciliation.md's "Reliability
-- limit"): a provider_events row can commit while the BullMQ enqueue that
-- was meant to follow it fails or the process crashes first. Only a fresh
-- INSERT previously triggered an enqueue, so a stuck RECEIVED/QUEUED row had
-- no path back to processing once the delivery that created it was gone.
--
-- This adds a narrow, SELECT-only platform_admin carve-out on
-- provider_events, matching ADR-0021's already-accepted pattern (see
-- 20260801100000_platform_admin_rls_read_carve_out): a scheduled recovery
-- sweep (ClockWorkerService, clock.webhooks queue) reads stale rows
-- cross-tenant under app.role = 'platform_admin', then re-enqueues each one
-- through the normal per-tenant path. No bypass-RLS connection is added and
-- no write policy changes — every write still goes through the existing
-- per-tenant provider_events_tenant_isolation policy via
-- withTenantTransaction.

DROP POLICY IF EXISTS "provider_events_platform_admin_read" ON "provider_events";
CREATE POLICY "provider_events_platform_admin_read" ON "provider_events"
  FOR SELECT
  USING (
    "tenant_id" = "app_current_tenant_id"()
    OR current_setting('app.role', true) = 'platform_admin'
  );
