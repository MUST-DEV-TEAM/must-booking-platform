import { describe, it, expect } from 'vitest';
import { pokpayBaseUrl, validPokpayWebhook } from './pokpay-environment';
describe('PokPay environments', () => {
  it('allows only the official staging and production API hosts', () => {
    expect(pokpayBaseUrl()).toBe('https://api-staging.pokpay.io');
    expect(pokpayBaseUrl('https://api.pokpay.io/')).toBe('https://api.pokpay.io');
    for (const host of [
      'http://api.pokpay.io',
      'https://api.pokpay.io.evil.test',
      'https://other.test',
    ])
      expect(pokpayBaseUrl(host)).toBeNull();
  });
  it('requires a public HTTPS production callback without credentials or fragments', () => {
    for (const url of [
      'http://app.test/callback',
      'https://localhost/a',
      'https://127.0.0.2/a',
      'https://10.1.2.3/a',
      'https://[::1]/a',
      'https://user:pass@app.test/a',
      'https://app.test/a#token',
    ])
      expect(validPokpayWebhook(url, 'https://api.pokpay.io')).toBe(false);
    expect(validPokpayWebhook('https://hotel.test/webhooks/pokpay', 'https://api.pokpay.io')).toBe(
      true,
    );
    expect(
      validPokpayWebhook('http://localhost:3000/webhooks/pokpay', 'https://api-staging.pokpay.io'),
    ).toBe(true);
  });
});
