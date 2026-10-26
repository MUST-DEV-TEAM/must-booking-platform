/** Production must never contact RFC-reserved test/example recipient domains. */
export function isReservedEmail(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').at(-1) ?? '';
  return (
    /(?:^|\.)(?:test|invalid|localhost|example)$/.test(domain) ||
    /^(?:.*\.)?example\.(?:com|org|net)$/.test(domain)
  );
}
/** Platform bound; a malformed environment value cannot disable the cap. */
export function propertyEmailHourlyCap(value = process.env.EMAIL_PROPERTY_HOURLY_CAP): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 10000 ? parsed : 500;
}
