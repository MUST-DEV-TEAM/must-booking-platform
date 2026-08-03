-- Milestone 10, Task 4: an individual-room booking records its selected room.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "room_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_room_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_room_fkey"
      FOREIGN KEY ("tenant_id", "property_id", "room_id")
      REFERENCES "rooms"("tenant_id", "property_id", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_tenant_property_room_stay_idx"
  ON "bookings" ("tenant_id", "property_id", "room_id", "starts_on", "ends_on")
  WHERE "room_id" IS NOT NULL;
