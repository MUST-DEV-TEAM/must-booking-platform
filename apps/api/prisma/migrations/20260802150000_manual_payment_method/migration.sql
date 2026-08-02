-- Milestone 9, Task 3: retain the tender used for manually recorded charges.
-- Existing gateway-created payments have no manual method and remain NULL.

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "method" VARCHAR(50);
