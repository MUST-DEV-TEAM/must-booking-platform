-- Daily euro-based exchange rates, used only to show approximate prices in other currencies.
-- Platform-wide public data (no tenant), never used for charging: guests pay in the hotel's currency.
CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency VARCHAR(3) NOT NULL,
  quote_currency VARCHAR(3) NOT NULL,
  rate NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
  rate_date DATE NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (base_currency, quote_currency)
);
