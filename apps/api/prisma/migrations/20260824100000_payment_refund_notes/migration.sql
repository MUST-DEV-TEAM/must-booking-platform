-- Milestone 13 Task 7: staff-only notes belong to refund payment rows.
-- Rollback plan: drop the constraint and nullable column after refund-note
-- consumers have been removed; existing payment rows remain valid.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "note" VARCHAR(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_note_refund_only'
      AND conrelid = 'payments'::regclass
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_note_refund_only"
      CHECK ("note" IS NULL OR "kind" = 'REFUND'::"PaymentKind");
  END IF;
END $$;
