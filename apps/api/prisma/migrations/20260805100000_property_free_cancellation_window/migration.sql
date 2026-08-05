-- Milestone 11.5 Task 3: configurable per-property cancellation-refund
-- window (default 21 days before arrival), used by Task 6's automatic
-- refund-on-cancellation logic.
ALTER TABLE "properties"
  ADD COLUMN "free_cancellation_days_before_arrival" INTEGER NOT NULL DEFAULT 21;
