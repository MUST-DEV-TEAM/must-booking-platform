-- The currency a booking's total is in, kept on the booking itself instead of only being worked out from its
-- rate plan. A Clock reservation takes the currency Clock bills it in. The database fills it in for every other
-- writer (from the rate plan), so no booking is ever without one, and keeps it in step when the plan changes.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

UPDATE bookings b SET currency = rp.currency
FROM rate_plans rp
WHERE b.currency IS NULL AND rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id;

CREATE OR REPLACE FUNCTION bookings_fill_currency() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.currency IS NULL THEN
      SELECT rp.currency INTO NEW.currency FROM rate_plans rp
      WHERE rp.tenant_id = NEW.tenant_id AND rp.property_id = NEW.property_id AND rp.id = NEW.rate_plan_id;
    END IF;
  ELSIF NEW.rate_plan_id IS DISTINCT FROM OLD.rate_plan_id AND NEW.currency IS NOT DISTINCT FROM OLD.currency THEN
    -- The plan changed and the statement did not choose a currency: follow the new plan.
    SELECT rp.currency INTO NEW.currency FROM rate_plans rp
    WHERE rp.tenant_id = NEW.tenant_id AND rp.property_id = NEW.property_id AND rp.id = NEW.rate_plan_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_fill_currency ON bookings;
CREATE TRIGGER bookings_fill_currency
  BEFORE INSERT OR UPDATE OF rate_plan_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_fill_currency();

-- A booking's currency and the one Clock bills it in disagree: raised for review instead of being accepted.
ALTER TYPE "ManualReviewCategory" ADD VALUE IF NOT EXISTS 'CURRENCY_MISMATCH';
