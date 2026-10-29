-- Hotel overrides are expressed as: 1 quote currency = rate hotel-default-currency units.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS rates_version BIGINT NOT NULL DEFAULT 0;
-- Unconfigured properties preserve Elementor choices; configured empty arrays mean hotel currency only.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS display_currencies TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS display_currencies_configured BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS property_exchange_rates (
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  quote_currency VARCHAR(3) NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate NUMERIC(20,8) NOT NULL CHECK (rate > 0 AND rate <= 1000000000),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID NOT NULL,
  PRIMARY KEY (tenant_id,property_id,quote_currency),
  FOREIGN KEY (tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS property_exchange_rate_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  quote_currency VARCHAR(3) NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  old_rate NUMERIC(20,8),
  new_rate NUMERIC(20,8),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID NOT NULL,
  CHECK (old_rate IS NOT NULL OR new_rate IS NOT NULL),
  CHECK (old_rate IS NULL OR old_rate > 0),
  CHECK (new_rate IS NULL OR new_rate > 0),
  FOREIGN KEY (tenant_id,property_id) REFERENCES properties(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS property_exchange_rate_changes_scope ON property_exchange_rate_changes(tenant_id,property_id,updated_at);
ALTER TABLE property_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_exchange_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_exchange_rates_scope ON property_exchange_rates;
CREATE POLICY property_exchange_rates_scope ON property_exchange_rates
  USING (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()))
  WITH CHECK (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()));
ALTER TABLE property_exchange_rate_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_exchange_rate_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_exchange_rate_changes_read ON property_exchange_rate_changes;
CREATE POLICY property_exchange_rate_changes_read ON property_exchange_rate_changes FOR SELECT
  USING (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()));
DROP POLICY IF EXISTS property_exchange_rate_changes_insert ON property_exchange_rate_changes;
CREATE POLICY property_exchange_rate_changes_insert ON property_exchange_rate_changes FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id() AND (app_current_property_id() IS NULL OR property_id=app_current_property_id()));
REVOKE UPDATE,DELETE ON property_exchange_rate_changes FROM must_booking_app;

CREATE OR REPLACE FUNCTION property_exchange_rate_base_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.default_currency IS DISTINCT FROM NEW.default_currency AND EXISTS (
    SELECT 1 FROM property_exchange_rates WHERE tenant_id=OLD.tenant_id AND property_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'Remove hotel exchange rates before changing the default currency.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS property_exchange_rate_base_guard ON properties;
CREATE TRIGGER property_exchange_rate_base_guard BEFORE UPDATE OF default_currency ON properties
  FOR EACH ROW EXECUTE FUNCTION property_exchange_rate_base_guard();

-- Only INSERT computes a snapshot. Existing payment amounts, currencies and stored rates are untouched.
CREATE OR REPLACE FUNCTION payments_set_fx_rate() RETURNS trigger AS $$
DECLARE
  booking_currency VARCHAR(3);
  hotel_currency VARCHAR(3);
  feed_hotel NUMERIC;
  from_rate NUMERIC;
  to_rate NUMERIC;
  from_date DATE;
  to_date DATE;
BEGIN
  IF NEW.fx_rate_to_booking IS NOT NULL THEN RETURN NEW; END IF;
  SELECT b.currency,COALESCE(p.default_currency,'EUR') INTO booking_currency,hotel_currency
  FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
  WHERE b.tenant_id=NEW.tenant_id AND b.property_id=NEW.property_id AND b.id=NEW.booking_id;
  IF booking_currency IS NULL OR booking_currency=NEW.currency THEN RETURN NEW; END IF;
  SELECT CASE WHEN hotel_currency='EUR' THEN 1 ELSE rate END INTO feed_hotel
    FROM (SELECT 1) seed LEFT JOIN exchange_rates ON base_currency='EUR' AND quote_currency=hotel_currency;
  -- If neither leg uses a hotel override or the hotel currency, the old euro pivot still works
  -- even when the feed has no hotel-base rate.
  IF feed_hotel IS NULL AND hotel_currency<>NEW.currency AND hotel_currency<>booking_currency AND NOT EXISTS (
    SELECT 1 FROM property_exchange_rates WHERE tenant_id=NEW.tenant_id AND property_id=NEW.property_id
      AND quote_currency IN (NEW.currency,booking_currency)
  ) THEN hotel_currency:='EUR'; feed_hotel:=1; END IF;
  -- Each leg is hotel-currency units per one unit of that currency. Hotel overrides win independently.
  IF NEW.currency=hotel_currency THEN from_rate:=1; from_date:=CURRENT_DATE;
  ELSE
    SELECT rate,updated_at::date INTO from_rate,from_date FROM property_exchange_rates
      WHERE tenant_id=NEW.tenant_id AND property_id=NEW.property_id AND quote_currency=NEW.currency;
    IF from_rate IS NULL THEN
      SELECT feed_hotel / CASE WHEN NEW.currency='EUR' THEN 1 ELSE rate END,
        CASE WHEN NEW.currency='EUR' THEN CURRENT_DATE ELSE rate_date END INTO from_rate,from_date
        FROM (SELECT 1) seed LEFT JOIN exchange_rates ON base_currency='EUR' AND quote_currency=NEW.currency;
      IF hotel_currency<>'EUR' THEN
        SELECT LEAST(from_date,rate_date) INTO from_date FROM exchange_rates WHERE base_currency='EUR' AND quote_currency=hotel_currency;
      END IF;
    END IF;
  END IF;
  IF booking_currency=hotel_currency THEN to_rate:=1; to_date:=CURRENT_DATE;
  ELSE
    SELECT rate,updated_at::date INTO to_rate,to_date FROM property_exchange_rates
      WHERE tenant_id=NEW.tenant_id AND property_id=NEW.property_id AND quote_currency=booking_currency;
    IF to_rate IS NULL THEN
      SELECT feed_hotel / CASE WHEN booking_currency='EUR' THEN 1 ELSE rate END,
        CASE WHEN booking_currency='EUR' THEN CURRENT_DATE ELSE rate_date END INTO to_rate,to_date
        FROM (SELECT 1) seed LEFT JOIN exchange_rates ON base_currency='EUR' AND quote_currency=booking_currency;
      IF hotel_currency<>'EUR' THEN
        SELECT LEAST(to_date,rate_date) INTO to_date FROM exchange_rates WHERE base_currency='EUR' AND quote_currency=hotel_currency;
      END IF;
    END IF;
  END IF;
  IF from_rate>0 AND to_rate>0 AND ROUND(from_rate/to_rate,8)>0 AND ROUND(from_rate/to_rate,8)<1000000000000 THEN
    NEW.fx_rate_to_booking:=from_rate/to_rate;
    NEW.fx_rate_date:=LEAST(from_date,to_date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
