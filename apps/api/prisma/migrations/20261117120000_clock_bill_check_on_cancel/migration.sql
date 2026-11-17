-- Milestone 40, task 12 (slice 40-12a): a booking that is cancelled or expires after it was confirmed gets its
-- Clock bill checked again. Until now the bill check ("financial:<id>" job) was queued only for CONFIRMED
-- bookings, so a cancelled booking whose Clock bill still showed a balance raised its "Needs attention" note
-- only if staff happened to open it.
--
-- 1. The existing trigger function also re-queues the check when a Clock booking moves to CANCELLED or EXPIRED
--    (an UPDATE of the status only: importing old cancelled bookings queues nothing). Same safety as before:
--    best effort, never blocks a booking write, runs with the caller's rights.
-- 2. One catch-up: cancelled or expired Clock bookings from the last 120 days that had a payment get the same
--    re-queue once. The check only READS Clock. It raises the existing note only where the bill still shows money.
--
-- Idempotent. Rollback:
--   re-apply the function body of 20261113160000_clock_sync_claim_index_and_bill_seed (the CONFIRMED branch only).
--   The catch-up only queues reads; there is nothing to undo.

CREATE OR REPLACE FUNCTION "clock_seed_financial_job"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND NEW.external_booking_id IS NOT NULL
     AND NEW.ends_on >= current_date - 30
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.external_booking_id IS DISTINCT FROM NEW.external_booking_id) THEN
    BEGIN
      INSERT INTO public.clock_sync_jobs (tenant_id, property_id, connection_id, resource, next_run_at)
      SELECT NEW.tenant_id, NEW.property_id, pc.connection_id, 'financial:' || NEW.id::text, now()
      FROM public.property_integration_connections pc
      JOIN public.integration_connections c ON c.tenant_id = pc.tenant_id AND c.id = pc.connection_id
      WHERE pc.tenant_id = NEW.tenant_id AND pc.property_id = NEW.property_id
        AND pc.enabled AND pc.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
      ON CONFLICT (tenant_id, property_id, connection_id, resource) DO NOTHING;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      NULL; -- no hotel in the session: the sync loop's once-a-minute seed adds the job
    END;
  ELSIF NEW.status IN ('CANCELLED', 'EXPIRED')
     AND NEW.external_booking_id IS NOT NULL
     AND TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    BEGIN
      INSERT INTO public.clock_sync_jobs (tenant_id, property_id, connection_id, resource, next_run_at, requested_at)
      SELECT NEW.tenant_id, NEW.property_id, pc.connection_id, 'financial:' || NEW.id::text, now(), now()
      FROM public.property_integration_connections pc
      JOIN public.integration_connections c ON c.tenant_id = pc.tenant_id AND c.id = pc.connection_id
      WHERE pc.tenant_id = NEW.tenant_id AND pc.property_id = NEW.property_id
        AND pc.enabled AND pc.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
      ON CONFLICT (tenant_id, property_id, connection_id, resource) DO UPDATE
        SET requested_at = COALESCE(public.clock_sync_jobs.requested_at, now()),
            next_run_at = LEAST(public.clock_sync_jobs.next_run_at, now())
        WHERE public.clock_sync_jobs.status IN ('SYNCED', 'RETRY', 'READY');
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION "clock_seed_financial_job"() FROM PUBLIC;

-- The catch-up: cancelled or expired Clock bookings with a payment, last 120 days.
INSERT INTO "clock_sync_jobs" ("tenant_id", "property_id", "connection_id", "resource", "next_run_at", "requested_at")
SELECT b."tenant_id", b."property_id", pc."connection_id", 'financial:' || b."id"::text, now(), now()
FROM "bookings" b
JOIN "property_integration_connections" pc ON pc."tenant_id" = b."tenant_id" AND pc."property_id" = b."property_id"
JOIN "integration_connections" c ON c."tenant_id" = pc."tenant_id" AND c."id" = pc."connection_id"
WHERE b."status" IN ('CANCELLED', 'EXPIRED')
  AND b."external_booking_id" IS NOT NULL
  AND b."updated_at" >= now() - interval '120 days'
  AND EXISTS (SELECT 1 FROM "payments" y WHERE y."tenant_id" = b."tenant_id" AND y."booking_id" = b."id")
  AND pc."enabled" AND pc."kind" = 'PMS' AND c."provider" = 'CLOCK_PMS' AND c."status" = 'CONNECTED'
ON CONFLICT ("tenant_id", "property_id", "connection_id", "resource") DO UPDATE
  SET "requested_at" = COALESCE("clock_sync_jobs"."requested_at", now()),
      "next_run_at" = LEAST("clock_sync_jobs"."next_run_at", now())
  WHERE "clock_sync_jobs"."status" IN ('SYNCED', 'RETRY', 'READY');
