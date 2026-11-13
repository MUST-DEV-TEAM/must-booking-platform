-- Milestone 38, task 2 (database review item 2): the Clock sync loop.
--
-- 1. An index that serves claim(): it filters clock_sync_jobs by hotel and connection and orders by
--    next_run_at, so an idle claim reads a handful of rows instead of scanning every job of the hotel.
-- 2. A trigger that queues a booking's bill check ("financial:<id>" job) the moment a Clock booking is
--    confirmed or imported. The sync loop now re-seeds jobs only once a minute per hotel, so without this
--    a new booking would wait up to a minute for its first bill check.
--
--    The seed is best effort and can never block a booking write: row-level security on clock_sync_jobs
--    needs the hotel in the session, and if a write runs without it, the insert is skipped and the
--    once-a-minute seed in the sync loop adds the job instead. SECURITY INVOKER: it runs with the caller's
--    rights and row-level security, like the application's own insert.
--
-- Idempotent. Plain CREATE INDEX: the table holds about 1,400 rows.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS bookings_clock_seed_financial_job ON bookings;
--   DROP FUNCTION IF EXISTS clock_seed_financial_job();
--   DROP INDEX IF EXISTS clock_sync_jobs_claim_idx;

CREATE INDEX IF NOT EXISTS "clock_sync_jobs_claim_idx"
  ON "clock_sync_jobs" ("tenant_id", "property_id", "connection_id", "next_run_at");

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
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION "clock_seed_financial_job"() FROM PUBLIC;

DROP TRIGGER IF EXISTS "bookings_clock_seed_financial_job" ON "bookings";
CREATE TRIGGER "bookings_clock_seed_financial_job"
  AFTER INSERT OR UPDATE OF "status", "external_booking_id" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "clock_seed_financial_job"();
