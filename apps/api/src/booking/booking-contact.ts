import { Prisma } from '@prisma/client';
// Fixed aliases b (booking) and g (directory guest). Never interpolate client SQL.
// Checking the whole snapshot preserves an explicitly cleared phone number.
export const BOOKING_CONTACT_SQL = {
  firstName:
    "(CASE WHEN b.guest_contact IS NOT NULL THEN b.guest_contact->>'firstName' ELSE g.first_name END)",
  lastName:
    "(CASE WHEN b.guest_contact IS NOT NULL THEN b.guest_contact->>'lastName' ELSE g.last_name END)",
  email: "(CASE WHEN b.guest_contact IS NOT NULL THEN b.guest_contact->>'email' ELSE g.email END)",
  phone: "(CASE WHEN b.guest_contact IS NOT NULL THEN b.guest_contact->>'phone' ELSE g.phone END)",
};
export const bookingContactSql = {
  firstName: Prisma.raw(BOOKING_CONTACT_SQL.firstName),
  lastName: Prisma.raw(BOOKING_CONTACT_SQL.lastName),
  email: Prisma.raw(BOOKING_CONTACT_SQL.email),
  phone: Prisma.raw(BOOKING_CONTACT_SQL.phone),
};
