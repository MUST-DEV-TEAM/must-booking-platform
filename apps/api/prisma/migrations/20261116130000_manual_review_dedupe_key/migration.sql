-- An open review item is raised once per thing: the service builds a key (category, kind, reference type,
-- reference id) and, while an OPEN item with that key exists, counts the repeat on it instead of adding a row.
-- Old duplicate rows are left alone here. The index is deliberately NOT unique: the unique version comes in a
-- later step, after the existing duplicates have been cleaned up.
-- Additive and idempotent. Roll back by ignoring the columns (the previous application never reads them), or:
--   DROP INDEX IF EXISTS manual_review_items_open_dedupe_idx;
--   ALTER TABLE manual_review_items DROP COLUMN IF EXISTS dedupe_key, DROP COLUMN IF EXISTS occurrences,
--     DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE manual_review_items ADD COLUMN IF NOT EXISTS dedupe_key varchar(400);
ALTER TABLE manual_review_items ADD COLUMN IF NOT EXISTS occurrences integer NOT NULL DEFAULT 1;
ALTER TABLE manual_review_items ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE INDEX IF NOT EXISTS manual_review_items_open_dedupe_idx
  ON manual_review_items (tenant_id, property_id, dedupe_key)
  WHERE status = 'OPEN' AND dedupe_key IS NOT NULL;
