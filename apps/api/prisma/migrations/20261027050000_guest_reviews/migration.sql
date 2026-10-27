-- A guest's review of one stay. A row is created when the review invitation goes out (token_hash is the only
-- thing stored of the private link, so it cannot be read back) and filled in once, when the guest submits it.
-- One review per stay is enforced by the unique booking id. Reviews are collected for the hotel only; nothing
-- here is published.
CREATE TABLE IF NOT EXISTS guest_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  property_id UUID NOT NULL,
  booking_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  overall SMALLINT CHECK (overall BETWEEN 1 AND 5),
  cleanliness SMALLINT CHECK (cleanliness BETWEEN 1 AND 5),
  staff SMALLINT CHECK (staff BETWEEN 1 AND 5),
  location SMALLINT CHECK (location BETWEEN 1 AND 5),
  comfort SMALLINT CHECK (comfort BETWEEN 1 AND 5),
  food SMALLINT CHECK (food BETWEEN 1 AND 5),
  value_for_money SMALLINT CHECK (value_for_money BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 2000),
  UNIQUE (tenant_id, booking_id),
  UNIQUE (tenant_id, token_hash),
  CHECK (submitted_at IS NULL OR overall IS NOT NULL),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, property_id, booking_id) REFERENCES bookings(tenant_id, property_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS guest_reviews_property_submitted
  ON guest_reviews (tenant_id, property_id, submitted_at DESC);
ALTER TABLE guest_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_reviews_scope ON guest_reviews;
CREATE POLICY guest_reviews_scope ON guest_reviews
  USING (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id())
  WITH CHECK (tenant_id = app_current_tenant_id() AND property_id = app_current_property_id());
