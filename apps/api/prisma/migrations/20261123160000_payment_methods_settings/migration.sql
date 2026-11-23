-- Settings redesign, Payment methods (S7a): the order and default of the checkout methods, what the hotel accepts
-- in person, how long a payment link stays valid, a second reminder and what happens when a link expires unpaid.
-- Saved and checked only: the booking page and the payment-link code do not read them yet (S7b).
-- An empty order means the standard order (Stripe, PokPay, pay at the hotel); an empty default means the first
-- method that is on. The link validity default of 7 days is what the code uses today.
--
-- Additive and re-runnable. Rollback: keep the columns and restore the previous application.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_method_order text[] NOT NULL DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_default_method varchar(30)
  CHECK (payment_default_method IS NULL OR payment_default_method IN ('stripe', 'pokpay', 'pay_at_hotel'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS accepted_at_hotel text[] NOT NULL DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_link_valid_days smallint NOT NULL DEFAULT 7
  CHECK (payment_link_valid_days BETWEEN 1 AND 14);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_second_reminder_days smallint
  CHECK (payment_second_reminder_days IS NULL OR payment_second_reminder_days BETWEEN 2 AND 13);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS payment_link_expiry_action varchar(20) NOT NULL DEFAULT 'notify_staff'
  CHECK (payment_link_expiry_action IN ('notify_staff', 'cancel_release'));
