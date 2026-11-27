import { Prisma } from '@prisma/client';

// Fixed aliases b (booking), r (room, LEFT JOIN) and rt (room type). Never interpolate client SQL.

/**
 * The room as a guest is told it: the room type. The room number is only an assignment the hotel (or the
 * PMS) can still change before arrival. A hotel that sells individual rooms only is the exception: there
 * the room is what the guest chose and bought.
 */
export const GUEST_ROOM_NAME_SQL = `(CASE WHEN r.name IS NOT NULL AND EXISTS (
  SELECT 1 FROM properties rp_mode WHERE rp_mode.tenant_id = b.tenant_id AND rp_mode.id = b.property_id
    AND rp_mode.booking_mode::text = 'INDIVIDUAL_ROOM_ONLY'
) THEN r.name ELSE rt.name END)`;

/** The room as staff are told it: the room type, followed by the assigned room when there is one. */
export const STAFF_ROOM_NAME_SQL = `(CASE
  WHEN r.name IS NULL OR r.name = rt.name THEN rt.name
  WHEN r.name ~ '^[0-9]+[A-Za-z]?$' THEN rt.name || ', room ' || r.name
  ELSE rt.name || ', ' || r.name END)`;

export const guestRoomNameSql = Prisma.raw(GUEST_ROOM_NAME_SQL);
export const staffRoomNameSql = Prisma.raw(STAFF_ROOM_NAME_SQL);
