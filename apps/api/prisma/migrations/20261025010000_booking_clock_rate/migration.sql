-- The published Clock rate a guest or staff member chose for the stay (for example Bed & breakfast
-- or Full board). Null means the cheapest or staff-ranked rate was used. Additive and re-runnable.
-- Rollback: the column can be dropped; it is read only when the Clock reservation is created.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS clock_rate_id text;
