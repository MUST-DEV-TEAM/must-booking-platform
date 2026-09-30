-- Same-day booking rule for the guest-facing channel (website / public API).
-- Staff walk-in bookings are same-day by nature and are never subject to it.
-- The cutoff is a local "HH:MM" on the property's own clock (properties.timezone);
-- NULL means "no cutoff" (same-day stays bookable all day while allowed).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS same_day_booking_allowed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS same_day_cutoff_time VARCHAR(5);
