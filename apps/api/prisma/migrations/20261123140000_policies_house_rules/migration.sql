-- Settings redesign, Policies (S5, step 1): check-in/out windows, cots and extra beds, pet details, house rules and
-- a damage deposit. Saved and checked only: nothing shows them to guests yet (gap G-55).
-- ID at arrival becomes a choice (not required / main guest / all adults) plus the accepted documents. Hotels that
-- had the old "ID required" switch on become "all adults" with passport and national ID accepted.
--
-- Additive and re-runnable. The old boolean id_required_at_arrival is kept (nothing reads it any more).
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS check_in_until varchar(5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS check_out_from varchar(5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS late_arrival_instructions varchar(500);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS cots_policy varchar(20) NOT NULL DEFAULT 'not_available'
  CHECK (cots_policy IN ('not_available', 'free', 'paid'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS cots_fee numeric(7, 2) CHECK (cots_fee IS NULL OR cots_fee > 0);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS cots_max smallint CHECK (cots_max IS NULL OR cots_max BETWEEN 0 AND 3);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS extra_beds_policy varchar(20) NOT NULL DEFAULT 'not_available'
  CHECK (extra_beds_policy IN ('not_available', 'free', 'paid'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS extra_beds_fee numeric(7, 2) CHECK (extra_beds_fee IS NULL OR extra_beds_fee > 0);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS extra_beds_max smallint CHECK (extra_beds_max IS NULL OR extra_beds_max BETWEEN 0 AND 3);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pets_fee_type varchar(10)
  CHECK (pets_fee_type IS NULL OR pets_fee_type IN ('free', 'per_night', 'per_stay'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pets_fee numeric(7, 2) CHECK (pets_fee IS NULL OR pets_fee > 0);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pets_max smallint CHECK (pets_max IS NULL OR pets_max BETWEEN 1 AND 5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS smoking_policy varchar(20)
  CHECK (smoking_policy IS NULL OR smoking_policy IN ('not_allowed', 'designated_areas', 'allowed'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS parties_policy varchar(20)
  CHECK (parties_policy IS NULL OR parties_policy IN ('not_allowed', 'on_request', 'allowed'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS id_at_arrival varchar(20) NOT NULL DEFAULT 'not_required'
  CHECK (id_at_arrival IN ('not_required', 'main_guest', 'all_adults'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS id_documents text[] NOT NULL DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS damage_deposit_amount numeric(7, 2)
  CHECK (damage_deposit_amount IS NULL OR damage_deposit_amount > 0);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS damage_deposit_method varchar(10)
  CHECK (damage_deposit_method IS NULL OR damage_deposit_method IN ('cash', 'card'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS damage_deposit_refund_days smallint
  CHECK (damage_deposit_refund_days IS NULL OR damage_deposit_refund_days BETWEEN 1 AND 30);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS other_house_rules varchar(1000);

-- Carry the old switch over once (re-running changes nothing: only hotels still on the default are touched).
UPDATE properties
SET id_at_arrival = 'all_adults', id_documents = ARRAY['passport', 'national_id']
WHERE id_required_at_arrival = true AND id_at_arrival = 'not_required' AND cardinality(id_documents) = 0;
