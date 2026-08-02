-- Milestone 9, Task 4 follow-up: staff-created bookings are not guest-session-owned.
-- Guest-facing authorization treats NULL as unreachable by any guest session.

ALTER TABLE "bookings"
  ALTER COLUMN "guest_session_id" DROP NOT NULL;
