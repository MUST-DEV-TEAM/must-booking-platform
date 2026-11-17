import { HttpException, HttpStatus } from '@nestjs/common';

/** Refusals that mean "the room, the date or the key is taken or busy": a conflict the guest can answer by choosing again. */
const CONFLICT_CODES = new Set([
  'AVAILABILITY_FAILED',
  'AUTO_ASSIGNMENT_UNAVAILABLE',
  'ROOM_UNAVAILABLE',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_CONFLICT',
  'VERSION_CONFLICT',
]);

/**
 * 409 when the stay is no longer available or the request is already running; 422 for every other refusal
 * (the price or quote no longer matches, a rule such as the minimum stay, an invalid request). Never a 5xx: the
 * error tracker alerts on those, and a refused booking is an expected answer, not a fault.
 */
export function refusedBookingStatus(error: { code: string }): number {
  return CONFLICT_CODES.has(error.code) ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY;
}

/**
 * A refused booking used to answer "201 Created" with `ok: false` in the body. It now answers with a real error
 * status and the SAME body, so a client that reads `body.error.message` (the WordPress plugin does) still shows
 * the reason; one that only checks the HTTP status now sees the refusal too.
 */
export function throwIfBookingRefused<T extends { ok: boolean; error?: { code: string } }>(
  result: T,
): T {
  if (!result.ok && result.error)
    throw new HttpException(result, refusedBookingStatus(result.error));
  return result;
}
