ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "special_requests" VARCHAR(2000);
