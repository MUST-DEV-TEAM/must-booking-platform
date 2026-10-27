-- Money integrity, enforced by the database so no writer can get around it.
-- 1. A booking's stored currency must be its rate plan's currency (checked when the transaction commits).
-- 2. A rate plan's currency cannot be changed once bookings use it: their totals would silently change meaning.
-- 3. A payment recorded in a different currency than its booking is never lost or blocked; it is recorded and
--    raised for review, because refusing to record money that was really received is worse.

CREATE OR REPLACE FUNCTION bookings_currency_matches_plan() RETURNS trigger AS $$
DECLARE plan_currency VARCHAR(3);
BEGIN
  SELECT rp.currency INTO plan_currency FROM rate_plans rp
  WHERE rp.tenant_id = NEW.tenant_id AND rp.property_id = NEW.property_id AND rp.id = NEW.rate_plan_id;
  IF NEW.currency IS NULL OR plan_currency IS NULL OR NEW.currency <> plan_currency THEN
    RAISE EXCEPTION 'Booking % is in currency % but its rate plan is in %', NEW.id, NEW.currency, plan_currency
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_currency_matches_plan ON bookings;
CREATE CONSTRAINT TRIGGER bookings_currency_matches_plan
  AFTER INSERT OR UPDATE OF currency, rate_plan_id ON bookings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bookings_currency_matches_plan();

CREATE OR REPLACE FUNCTION rate_plans_currency_is_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.tenant_id = OLD.tenant_id AND b.property_id = OLD.property_id AND b.rate_plan_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'The currency of a rate plan with bookings cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_plans_currency_is_fixed ON rate_plans;
CREATE TRIGGER rate_plans_currency_is_fixed
  BEFORE UPDATE OF currency ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION rate_plans_currency_is_fixed();

CREATE OR REPLACE FUNCTION payments_flag_currency_difference() RETURNS trigger AS $$
DECLARE booking_currency VARCHAR(3);
BEGIN
  SELECT b.currency INTO booking_currency FROM bookings b
  WHERE b.tenant_id = NEW.tenant_id AND b.property_id = NEW.property_id AND b.id = NEW.booking_id;
  IF booking_currency IS NOT NULL AND NEW.currency IS DISTINCT FROM booking_currency THEN
    INSERT INTO manual_review_items (tenant_id, property_id, category, reference_type, reference_id, message, context)
    SELECT NEW.tenant_id, NEW.property_id, 'CURRENCY_MISMATCH'::"ManualReviewCategory", 'booking', NEW.booking_id::text,
      'A payment was recorded in ' || COALESCE(NEW.currency, 'an unknown currency') || ' but the booking is in ' || booking_currency
        || '. The payment is kept; check how it should be counted.',
      jsonb_build_object('paymentCurrency', NEW.currency, 'bookingCurrency', booking_currency, 'paymentId', NEW.id)
    WHERE NOT EXISTS (
      SELECT 1 FROM manual_review_items m
      WHERE m.tenant_id = NEW.tenant_id AND m.property_id = NEW.property_id AND m.category = 'CURRENCY_MISMATCH'
        AND m.reference_type = 'booking' AND m.reference_id = NEW.booking_id::text AND m.status = 'OPEN'
        AND m.context->>'paymentId' IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_flag_currency_difference ON payments;
CREATE TRIGGER payments_flag_currency_difference
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_flag_currency_difference();
