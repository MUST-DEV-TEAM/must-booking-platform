-- Why a block exists and who made it (Milestone 24, G41): a reason from a fixed list, an optional
-- note and reference (for example a work-order number), and the staff member who created it.
ALTER TABLE "availability_blocks"
  ADD COLUMN IF NOT EXISTS "reason" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "note" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "reference" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID;
