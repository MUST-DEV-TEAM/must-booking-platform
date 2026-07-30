-- Milestone 4, Task 3: preserve staff-configured inventory and track booked units separately.
ALTER TABLE "inventory_units"
  ADD COLUMN IF NOT EXISTS "booked_units" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE "inventory_units"
    ADD CONSTRAINT "inventory_units_booked_units_check" CHECK ("booked_units" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "inventory_units"
    ADD CONSTRAINT "inventory_units_booked_units_available_units_check"
      CHECK ("booked_units" <= "available_units");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
