-- One OPEN review item per key (M39 task 6, step 3). Replaces the plain index from 20261116130000.
-- Safe to deploy at any time: if an OPEN duplicate exists the migration changes nothing and says so;
-- the next deploy tries again after the clean-up (infrastructure/ops/review-queue-cleanup.sql) is run.
-- Roll back with:
--   DROP INDEX IF EXISTS manual_review_items_open_dedupe_unique;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM manual_review_items
    WHERE status = 'OPEN' AND dedupe_key IS NOT NULL
    GROUP BY tenant_id, property_id, dedupe_key HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'manual_review_items: open duplicates exist, unique index not created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS manual_review_items_open_dedupe_unique
      ON manual_review_items (tenant_id, property_id, dedupe_key)
      WHERE status = 'OPEN' AND dedupe_key IS NOT NULL;
    DROP INDEX IF EXISTS manual_review_items_open_dedupe_idx;
  END IF;
END
$$;
