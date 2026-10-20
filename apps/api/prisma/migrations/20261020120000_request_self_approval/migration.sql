-- Additive B1 correction. Existing forced RLS and immutable-decision trigger apply to this column.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false;
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_self_approved_check;
ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_self_approved_check
 CHECK (NOT self_approved OR (status='Approved' AND reviewer_id=requester_id));
-- Rollback after reverting the application (export decision evidence first):
-- ALTER TABLE booking_requests DROP COLUMN self_approved;
