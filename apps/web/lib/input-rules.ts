/**
 * Rules for what may be typed into common fields, kept in one place so every form behaves the
 * same. The `clean*` functions are used while typing (they remove characters that can never be
 * valid); the `*Error` functions are used to explain a problem once the person is done.
 */

/** Only the digits 0-9. */
export const cleanDigits = (value: string) => value.replace(/\D+/g, '');

/** Letters of any alphabet, spaces, apostrophes, dots and hyphens (names of people and places). */
export const cleanName = (value: string) =>
  value.replace(/[^\p{L}\p{M}\s'’.-]+/gu, '').replace(/\s{2,}/g, ' ');

/** Letters, digits, spaces, commas, dots, hyphens, slashes and apostrophes (street addresses). */
export const cleanAddress = (value: string) =>
  value.replace(/[^\p{L}\p{M}\p{N}\s,.'’/#-]+/gu, '').replace(/\s{2,}/g, ' ');

/** Letters, digits, spaces and hyphens (postcodes). */
export const cleanPostcode = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .replace(/\s{2,}/g, ' ')
    .toUpperCase();

/** An email as typed: no spaces. */
export const cleanEmail = (value: string) => value.replace(/\s+/g, '');

export const LIMITS = {
  name: 100,
  email: 254,
  phoneDigits: 15,
  street: 255,
  city: 100,
  postcode: 30,
  note: 1000,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailError(value: string, required = true): string | null {
  const email = value.trim();
  if (!email) return required ? 'Enter an email address.' : null;
  if (email.length > LIMITS.email) return 'This email address is too long.';
  return EMAIL.test(email) ? null : 'Enter a valid email address, like name@example.com.';
}

export function nameError(value: string, label: string, required = true): string | null {
  const name = value.trim();
  if (!name) return required ? `Enter the ${label}.` : null;
  if (name.length < 2) return `The ${label} is too short.`;
  return null;
}

/** The number part only (the country prefix is chosen separately). The longest number is 15 digits including the prefix. */
export function phoneError(digits: string, prefixDigits: number, required = false): string | null {
  if (!digits) return required ? 'Enter a phone number.' : null;
  if (digits.length < 5) return 'This phone number is too short.';
  if (digits.length + prefixDigits > LIMITS.phoneDigits) return 'This phone number is too long.';
  return null;
}
