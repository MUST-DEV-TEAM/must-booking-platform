-- A payment made in a different currency than its booking keeps the exchange rate of the day it was recorded,
-- so staff can see an approximate amount in the booking's currency that does not move with later rates.
-- The rate is stored once, when the payment row is written, by the database itself so that no writer can forget.
-- Older payments have no stored rate; the screens show today's rate for them, marked as an estimate.

ALTER TABLE "payments"
  ADD COLUMN "fx_rate_to_booking" NUMERIC(20, 8) CHECK ("fx_rate_to_booking" IS NULL OR "fx_rate_to_booking" > 0),
  ADD COLUMN "fx_rate_date" DATE;

CREATE OR REPLACE FUNCTION payments_set_fx_rate() RETURNS trigger AS $$
DECLARE
  booking_currency VARCHAR(3);
  from_rate NUMERIC;
  to_rate NUMERIC;
  from_date DATE;
  to_date DATE;
BEGIN
  IF NEW.fx_rate_to_booking IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT b.currency INTO booking_currency FROM bookings b
  WHERE b.tenant_id = NEW.tenant_id AND b.property_id = NEW.property_id AND b.id = NEW.booking_id;
  IF booking_currency IS NULL OR booking_currency = NEW.currency THEN
    RETURN NEW;
  END IF;
  -- The stored rates are euro-based (how many units of a currency one euro buys), so any pair goes through the euro.
  IF NEW.currency = 'EUR' THEN from_rate := 1; from_date := CURRENT_DATE;
  ELSE SELECT rate, rate_date INTO from_rate, from_date FROM exchange_rates WHERE base_currency = 'EUR' AND quote_currency = NEW.currency;
  END IF;
  IF booking_currency = 'EUR' THEN to_rate := 1; to_date := CURRENT_DATE;
  ELSE SELECT rate, rate_date INTO to_rate, to_date FROM exchange_rates WHERE base_currency = 'EUR' AND quote_currency = booking_currency;
  END IF;
  IF from_rate IS NOT NULL AND from_rate > 0 AND to_rate IS NOT NULL AND to_rate > 0 THEN
    NEW.fx_rate_to_booking := to_rate / from_rate;
    NEW.fx_rate_date := LEAST(from_date, to_date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_set_fx_rate ON payments;
CREATE TRIGGER payments_set_fx_rate
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_set_fx_rate();
