-- Task 7's bookings_tenant_guest_fkey was added NOT VALID as a precaution against
-- pre-existing booking rows from before the guests table existed. Confirmed no such
-- rows remain in this environment; validate the constraint so it is fully enforced,
-- not just applied to new writes.
ALTER TABLE "bookings" VALIDATE CONSTRAINT "bookings_tenant_guest_fkey";
