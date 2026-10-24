/** Official production/staging hosts: https://payments.doc.pokpay.io/ */
export function pokpayBaseUrl(value?: string): string | null {
  const base = (value?.trim() || 'https://api-staging.pokpay.io').replace(/\/$/, '');
  return ['https://api-staging.pokpay.io', 'https://api.pokpay.io'].includes(base) ? base : null;
}
export function validPokpayWebhook(value: string, base: string): boolean {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash) return false;
    return base === 'https://api.pokpay.io'
      ? u.protocol === 'https:' &&
          !['localhost', '[::1]'].includes(u.hostname) &&
          !/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname) &&
          !u.hostname.endsWith('.localhost')
      : ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}
