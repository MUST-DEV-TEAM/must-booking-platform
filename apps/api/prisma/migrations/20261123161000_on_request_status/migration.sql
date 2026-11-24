-- Additive and safe to re-run. Rollback: first stop new requests and resolve every
-- ON_REQUEST_PENDING booking, then deploy the preceding application. PostgreSQL enum
-- values remain; removing them requires a separately reviewed type rebuild.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'ON_REQUEST_PENDING';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS on_request_deadline_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_pending_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS on_request_checkout_url varchar(2048);
