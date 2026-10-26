/**
 * Addresses that can never receive mail: the reserved test domains (RFC 2606 / 6761)
 * and their subdomains. Sending to them only uses up the mail quota and hurts the
 * sender's reputation with the mail provider.
 */
const RESERVED_TOP_LEVEL_DOMAINS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

export function isReservedTestAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  const domain = address
    .slice(at + 1)
    .trim()
    .replace(/>$/, '')
    .toLowerCase();
  return (
    RESERVED_TOP_LEVEL_DOMAINS.some((tld) => domain === tld || domain.endsWith(`.${tld}`)) ||
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  );
}
