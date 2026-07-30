-- Milestone 2, Task 2: fields captured for the first property at signup.
-- Nullable columns keep the additive migration safe for any pre-existing properties;
-- the signup API requires both fields for all newly created properties.
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "address" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(100);
