import { afterEach, describe, expect, it } from 'vitest';

import {
  POKPAY_PRODUCTION_BASE_URL,
  POKPAY_STAGING_BASE_URL,
  isAllowedPokpayBaseUrl,
  resolvePokpayBaseUrl,
  resolvePokpayWebhookUrl,
} from './pokpay-environments';

describe('PokPay environments', () => {
  const originalWebAppUrl = process.env.WEB_APP_URL;
  afterEach(() => {
    if (originalWebAppUrl === undefined) delete process.env.WEB_APP_URL;
    else process.env.WEB_APP_URL = originalWebAppUrl;
  });

  it('defaults to staging and only goes to production when asked', () => {
    expect(resolvePokpayBaseUrl({})).toBe(POKPAY_STAGING_BASE_URL);
    expect(resolvePokpayBaseUrl({ environment: 'staging' })).toBe(POKPAY_STAGING_BASE_URL);
    expect(resolvePokpayBaseUrl({ environment: 'anything-else' })).toBe(POKPAY_STAGING_BASE_URL);
    expect(resolvePokpayBaseUrl({ environment: 'Production' })).toBe(POKPAY_PRODUCTION_BASE_URL);
  });

  it('lets an explicit baseUrl on an older connection win', () => {
    expect(
      resolvePokpayBaseUrl({ baseUrl: `${POKPAY_PRODUCTION_BASE_URL}/`, environment: 'staging' }),
    ).toBe(POKPAY_PRODUCTION_BASE_URL);
  });

  it('only allows the two PokPay hosts', () => {
    expect(isAllowedPokpayBaseUrl(POKPAY_STAGING_BASE_URL)).toBe(true);
    expect(isAllowedPokpayBaseUrl(POKPAY_PRODUCTION_BASE_URL)).toBe(true);
    expect(isAllowedPokpayBaseUrl('https://api.pokpay.io.evil.example')).toBe(false);
    expect(isAllowedPokpayBaseUrl('http://api.pokpay.io')).toBe(false);
  });

  it('derives the webhook URL from the web origin unless one was entered', () => {
    process.env.WEB_APP_URL = 'https://booking.example.test/';
    expect(resolvePokpayWebhookUrl(undefined)).toBe(
      'https://booking.example.test/api/webhooks/pokpay',
    );
    expect(resolvePokpayWebhookUrl('  https://old.example.test/hook ')).toBe(
      'https://old.example.test/hook',
    );
    delete process.env.WEB_APP_URL;
    expect(resolvePokpayWebhookUrl(undefined)).toBeUndefined();
  });
});
