import type { ClockConnectionCredentials } from './clock-http-client';

const REQUIRED_FIELDS: Array<keyof ClockConnectionCredentials> = [
  'host',
  'accountId',
  'subscriptionId',
  'apiUser',
  'apiKey',
];

export type ParsedClockCredentials =
  { ok: true; value: ClockConnectionCredentials } | { ok: false; message: string };

/** Shared by everything that turns a generic Record<string,string> (however
 * it was stored/decrypted) into the typed shape ClockHttpClient needs. */
export function parseClockCredentials(raw: Record<string, string>): ParsedClockCredentials {
  const missing = REQUIRED_FIELDS.filter((field) => !raw[field]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing required Clock credential field(s): ${missing.join(', ')}.`,
    };
  }
  return {
    ok: true,
    value: {
      host: raw.host.trim(),
      accountId: raw.accountId.trim(),
      subscriptionId: raw.subscriptionId.trim(),
      apiUser: raw.apiUser.trim(),
      apiKey: raw.apiKey,
    },
  };
}

/**
 * Clock API hosts MUST sends requests to (task 39-10a, MBA-105). Only the host every live connection uses and the
 * sandbox confirmed: Clock publishes no list of its regional hosts, so another one is added here only once verified
 * with Clock, never guessed. CLOCK_EXTRA_API_HOSTS adds exact host names (comma separated, no wildcards) for test
 * stubs; production leaves it unset.
 */
export const CLOCK_API_HOSTS: readonly string[] = ['sky-eu1.clock-software.com'];

export const CLOCK_HOST_NOT_ALLOWED_MESSAGE =
  "The Clock host must be Clock's API address (for example sky-eu1.clock-software.com).";

export function isAllowedClockHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (CLOCK_API_HOSTS.includes(value)) return true;
  const extra = (process.env.CLOCK_EXTRA_API_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!extra.length) return false;
  // A test stub listens on a random port: an extra name matches with or without one.
  const name = /^([^:/@\s]+)(:\d{1,5})?$/.exec(value)?.[1];
  return name !== undefined && extra.includes(name);
}
