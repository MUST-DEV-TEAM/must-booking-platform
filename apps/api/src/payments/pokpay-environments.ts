// PokPay serves staging and production from two separate API hosts. A property opts in to
// production by setting this base URL on its connection; with none set it stays on staging.
export const POKPAY_STAGING_BASE_URL = 'https://api-staging.pokpay.io';
export const POKPAY_PRODUCTION_BASE_URL = 'https://api.pokpay.io';

const ALLOWED_BASE_URLS: readonly string[] = [POKPAY_STAGING_BASE_URL, POKPAY_PRODUCTION_BASE_URL];

export const POKPAY_BASE_URL_MESSAGE = `PokPay baseUrl must be ${POKPAY_STAGING_BASE_URL} or ${POKPAY_PRODUCTION_BASE_URL}.`;

export function normalizePokpayBaseUrl(value: string | undefined): string {
  return (value?.trim() || POKPAY_STAGING_BASE_URL).replace(/\/$/, '');
}

/** The connection's "environment" choice picks the host; an explicit baseUrl still wins. */
export function resolvePokpayBaseUrl(credentials: {
  baseUrl?: string;
  environment?: string;
}): string {
  if (credentials.baseUrl?.trim()) return normalizePokpayBaseUrl(credentials.baseUrl);
  return credentials.environment?.trim().toLowerCase() === 'production'
    ? POKPAY_PRODUCTION_BASE_URL
    : POKPAY_STAGING_BASE_URL;
}

/**
 * PokPay calls this URL when an order changes. It is our own endpoint (the web host proxies
 * /api to the API), identical for staging and production, so it is derived rather than typed.
 * An explicit webhookUrl on older connections still wins.
 */
export function resolvePokpayWebhookUrl(explicit: string | undefined): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const origin = process.env.WEB_APP_URL?.trim().replace(/\/$/, '');
  return origin ? `${origin}/api/webhooks/pokpay` : undefined;
}

export function isAllowedPokpayBaseUrl(baseUrl: string): boolean {
  return ALLOWED_BASE_URLS.includes(baseUrl);
}
