-- When the guest was recorded as arrived (the stay status became 'checked_in'). Stamped by the database itself,
-- whichever way the status changes (a Clock read, a future built-in check-in), and kept if the guest later
-- checks out. Used to send the check-in day welcome one hour after the guest is in the hotel.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "checked_in_at" TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION bookings_stamp_checked_in() RETURNS trigger AS $$
BEGIN
  IF NEW.pms_stay_status = 'checked_in' AND NEW.checked_in_at IS NULL THEN
    NEW.checked_in_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_stamp_checked_in ON "bookings";
CREATE TRIGGER bookings_stamp_checked_in
  BEFORE INSERT OR UPDATE OF pms_stay_status ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION bookings_stamp_checked_in();
