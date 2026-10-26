-- A use of a promo code is a booking that carries it and has not failed or been cancelled, counted when
-- needed, so a use is given back by itself. The separate counter could drift and is removed.
ALTER TABLE promo_codes DROP COLUMN IF EXISTS redemptions;
