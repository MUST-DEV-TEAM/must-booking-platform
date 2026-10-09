-- The PMS's own stay status for a booking (for Clock: expected, checked_in,
-- checked_out, no_show, canceled, or any value Clock adds later), stored as
-- received so staff can see it and an unknown value is never lost.
-- NULL for bookings never read back from a PMS.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pms_stay_status VARCHAR(40);
