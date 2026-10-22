-- Additive: NULL preserves unknown legacy ages. No price or age-band policy is invented.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS children_ages JSONB;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bookings_child_ages_shape') THEN
 ALTER TABLE bookings ADD CONSTRAINT bookings_child_ages_shape CHECK(children_ages IS NULL OR (jsonb_typeof(children_ages)='array' AND jsonb_array_length(children_ages)=children));
END IF; END $$;
-- Rollback: stop writing ages and archive this column before any owner-approved DROP.
