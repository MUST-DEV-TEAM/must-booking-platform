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
