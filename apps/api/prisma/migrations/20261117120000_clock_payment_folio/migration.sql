-- Where a website payment is posted in Clock: DEPOSIT (a deposit folio, which the hotel converts to an advance
-- invoice; what every hotel has always had) or MAIN (the booking's own folio, nothing to convert and no
-- advance invoice). Additive and idempotent. Roll back by setting every row to DEPOSIT before deploying the
-- old application; retain the column.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS clock_payment_folio varchar(10) NOT NULL DEFAULT 'DEPOSIT';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_clock_payment_folio_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_clock_payment_folio_check
      CHECK (clock_payment_folio IN ('DEPOSIT', 'MAIN'));
  END IF;
END $$;
