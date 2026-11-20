-- Settings redesign, Booking rules (S4c): confirmation mode and the booking form field table.
-- Additive and defaulted; nothing reads them until the booking pages are switched over.
-- confirmation_mode: instant (default) or on_request (staff accept or decline within on_request_hours; empty = 24).
-- form_*: each booking form field is required, optional or hidden. Email and main guest name are always required.
-- Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS confirmation_mode varchar(10) NOT NULL DEFAULT 'instant' CHECK (confirmation_mode IN ('instant', 'on_request'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS on_request_hours integer CHECK (on_request_hours IS NULL OR on_request_hours BETWEEN 1 AND 48);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_phone varchar(8) NOT NULL DEFAULT 'required' CHECK (form_phone IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_country varchar(8) NOT NULL DEFAULT 'optional' CHECK (form_country IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_address varchar(8) NOT NULL DEFAULT 'hidden' CHECK (form_address IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_arrival_time varchar(8) NOT NULL DEFAULT 'optional' CHECK (form_arrival_time IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_special_requests varchar(8) NOT NULL DEFAULT 'optional' CHECK (form_special_requests IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_guest_name_per_room varchar(8) NOT NULL DEFAULT 'hidden' CHECK (form_guest_name_per_room IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_company varchar(8) NOT NULL DEFAULT 'hidden' CHECK (form_company IN ('required', 'optional', 'hidden'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS form_marketing varchar(8) NOT NULL DEFAULT 'optional' CHECK (form_marketing IN ('required', 'optional', 'hidden'));
