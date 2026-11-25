-- Settings redesign, Booking rules (S4b): group request form, guest ages and gap filling.
-- Additive and nullable or defaulted; nothing reads them until the booking pages are switched over.
-- Ages: empty means the default (minimum booking age 18, children up to 12, infants up to 2).
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS group_request_form boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS group_request_email varchar(254);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS min_booking_age integer CHECK (min_booking_age IS NULL OR min_booking_age BETWEEN 16 AND 25);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS children_up_to_age integer CHECK (children_up_to_age IS NULL OR children_up_to_age BETWEEN 1 AND 17);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS infants_up_to_age integer CHECK (infants_up_to_age IS NULL OR infants_up_to_age BETWEEN 0 AND 5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS ask_children_ages boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS fill_gap_nights boolean NOT NULL DEFAULT false;
