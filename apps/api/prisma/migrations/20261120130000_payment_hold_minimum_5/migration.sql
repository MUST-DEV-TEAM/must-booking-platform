-- The unpaid online booking hold may now be as short as 5 minutes (was 10). The upper bound stays 1440.
-- Existing values (all 10 or more) stay valid. Additive in effect and safe to re-run.
-- Rollback: raise any hold under 10 first (UPDATE properties SET online_payment_hold_minutes = 10
--   WHERE online_payment_hold_minutes < 10), then drop the constraint and add it back with BETWEEN 10 AND 1440.
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_online_payment_hold_minutes_check;
ALTER TABLE properties ADD CONSTRAINT properties_online_payment_hold_minutes_check
  CHECK (online_payment_hold_minutes BETWEEN 5 AND 1440);
