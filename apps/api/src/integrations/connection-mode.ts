import { POKPAY_STAGING_BASE_URL, resolvePokpayBaseUrl } from '../payments/pokpay-environments';

/** Whether a payment connection moves real money (LIVE) or is a provider test account (TEST). */
export type ConnectionMode = 'TEST' | 'LIVE';

/**
 * The mode a connection's own keys put it in. PokPay is decided by its API host (staging or production),
 * Stripe by its secret key prefix. A PMS connection has no mode. Anything that is not clearly a test
 * account is treated as LIVE, so an unknown value is never mistaken for play money.
 */
export function connectionMode(
  provider: string,
  credentials: Record<string, string | undefined> | null | undefined,
): ConnectionMode | null {
  if (provider === 'POKPAY')
    return resolvePokpayBaseUrl(credentials ?? {}) === POKPAY_STAGING_BASE_URL ? 'TEST' : 'LIVE';
  if (provider === 'STRIPE')
    return credentials?.secretKey?.trim().startsWith('sk_test_') ? 'TEST' : 'LIVE';
  return null;
}
