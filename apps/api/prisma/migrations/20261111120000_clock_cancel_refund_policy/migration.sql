-- What happens to the guest's payment when the hotel cancels a booking inside Clock:
-- NEVER (nothing, the hotel decides), FREE_WINDOW (refund only inside the booking's frozen free-cancellation
-- window) or ALWAYS (refund in full). Additive and idempotent. Roll back by setting every row to NEVER before
-- deploying the old application; retain the column.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS clock_cancel_refund_policy varchar(20) NOT NULL DEFAULT 'NEVER';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_clock_cancel_refund_policy_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_clock_cancel_refund_policy_check
      CHECK (clock_cancel_refund_policy IN ('NEVER', 'FREE_WINDOW', 'ALWAYS'));
  END IF;
END $$;
