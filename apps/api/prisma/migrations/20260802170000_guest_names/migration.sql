-- Milestone 9, Task 6: retain the latest guest name supplied with a booking.
-- Existing guest records remain unnamed until a later booking refreshes them.

ALTER TABLE "guests"
  ADD COLUMN IF NOT EXISTS "first_name" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "last_name" VARCHAR(100);
