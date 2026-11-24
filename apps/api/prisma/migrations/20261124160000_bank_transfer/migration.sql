-- Bank transfer as a way for a guest to pay (gap G-48). The booking waits in PAYMENT_PENDING with its own
-- deadline (the existing payment_due_at, swept by the existing expiry sweep) and the room is held until then.
-- Staff mark the transfer received; nothing is charged by MUST.
--
-- Additive. Rollback: stop offering the method (bank_transfer_enabled = false), resolve open bank-transfer
-- bookings, then:
--   ALTER TABLE properties DROP COLUMN IF EXISTS bank_transfer_enabled, DROP COLUMN IF EXISTS bank_transfer_days,
--     DROP COLUMN IF EXISTS bank_account_holder, DROP COLUMN IF EXISTS bank_iban, DROP COLUMN IF EXISTS bank_bic,
--     DROP COLUMN IF EXISTS bank_name, DROP COLUMN IF EXISTS bank_transfer_note;
-- (a value added to an enum type cannot be removed; leaving it unused is harmless.)

ALTER TYPE "BookingPaymentMethod" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS bank_transfer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_transfer_days smallint NOT NULL DEFAULT 3
    CHECK (bank_transfer_days BETWEEN 1 AND 14),
  ADD COLUMN IF NOT EXISTS bank_account_holder varchar(120),
  ADD COLUMN IF NOT EXISTS bank_iban varchar(34),
  ADD COLUMN IF NOT EXISTS bank_bic varchar(11),
  ADD COLUMN IF NOT EXISTS bank_name varchar(120),
  ADD COLUMN IF NOT EXISTS bank_transfer_note varchar(300);
