-- Task 40-4b: a room type's guest capacity that the hotel has checked.
-- Clock has no room-type capacity, so the hotel confirms it in MUST. Both columns are optional:
-- nothing is enforced or changed for a room type until the hotel confirms it.
ALTER TABLE "room_types"
  ADD COLUMN "capacity_confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "clock_rate_capacity" INTEGER;

COMMENT ON COLUMN "room_types"."capacity_confirmed_at" IS 'When the hotel confirmed max_occupancy. NULL: not confirmed; for a Clock hotel the rates job may still update max_occupancy.';
COMMENT ON COLUMN "room_types"."clock_rate_capacity" IS 'Largest guest limit on the Clock rates of this room type (adults plus children), kept by the rates job. NULL when a rate states no adult limit or the hotel has no Clock.';
