-- Counts how many times in a row a Clock sync job failed with an error that retrying cannot fix (a bill whose
-- currencies disagree). The sync loop uses it to wait longer after each failure (1 min, 5 min, 30 min, 6 hours)
-- and to raise one review note for the booking. Reset to 0 on success and when staff run a check.
-- Additive and idempotent. Roll back by ignoring the column (the previous application never reads it).
ALTER TABLE clock_sync_jobs ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
