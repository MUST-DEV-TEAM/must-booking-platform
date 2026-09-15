import { randomInt } from 'node:crypto';

// Avoids 0/O/1/I, which are easy to misread when a reference is read aloud
// or typed back in at a front desk.
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** First letter of each word in the property's own name, e.g. "MUST" -> "M",
 * "Las Vegas Hotel" -> "LVH". Falls back to "MB" for a name with no letters. */
export function propertyInitials(propertyName: string): string {
  const initials = propertyName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join('')
    .slice(0, 8);
  return initials || 'MB';
}

/** `<hotel-initials>-YYMMDD-HHMM-<4 random chars>`, e.g. "MLDH-260814-2216-K7P4".
 * The random suffix must be wide enough that two bookings for the same
 * property in the same minute don't collide on the real database unique
 * constraint (`bookings_tenant_id_property_id_external_reference_key`) --
 * confirmed as a real, reachable collision at the old 2-character width
 * (33^2 = 1,089 combinations/minute/property) while verifying Milestone 21
 * Tasks 20-21, not just a theoretical concern. */
export function generateBookingReference(propertyName: string): string {
  const prefix = propertyInitials(propertyName);
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${pad(now.getUTCFullYear() % 100)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  const suffix = Array.from(
    { length: 4 },
    () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)],
  ).join('');
  return `${prefix}-${date}-${time}-${suffix}`;
}
