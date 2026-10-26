-- The hotel's own promo codes. A guest or staff member enters a code; the server checks its rules and
-- takes the discount off the quote. The booking keeps the code, the discount and the original price.
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  code TEXT NOT NULL CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{3,30}$'),
  kind TEXT NOT NULL CHECK (kind IN ('PERCENT', 'FIXED')),
  value NUMERIC(12, 2) NOT NULL CHECK (value > 0),
  -- A fixed amount is in this currency (the hotel currency); a percentage has none.
  currency VARCHAR(3),
  description TEXT,
  -- When the code may be used (the day the booking is made) and which stays it covers.
  book_from DATE,
  book_until DATE,
  stay_from DATE,
  stay_until DATE,
  min_nights INTEGER CHECK (min_nights IS NULL OR min_nights >= 1),
  -- Null means every room type.
  room_type_ids UUID[],
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
  redemptions INTEGER NOT NULL DEFAULT 0 CHECK (redemptions >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, property_id, code),
  CHECK (kind <> 'PERCENT' OR value <= 100),
  CHECK (kind <> 'FIXED' OR currency IS NOT NULL),
  CHECK (book_from IS NULL OR book_until IS NULL OR book_from <= book_until),
  CHECK (stay_from IS NULL OR stay_until IS NULL OR stay_from <= stay_until),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promo_codes_scope ON promo_codes;
CREATE POLICY promo_codes_scope ON promo_codes
  USING (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id())
  WITH CHECK (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id());

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS original_total_amount NUMERIC(12, 2);
