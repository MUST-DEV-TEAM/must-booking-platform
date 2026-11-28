import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * A hotel's own website calls this API from its server, so the API sees one address for all of that hotel's
 * visitors. A website that proves who it is with its secret key may say which visitor it is calling for, and each
 * visitor then gets their own rate-limit window. Without a valid key the forwarded address is ignored.
 *
 * `WEBSITE_CLIENT_KEYS` holds `propertyId:sha256-of-the-key` pairs, comma separated (several per property are
 * allowed, so a key can be replaced without a gap). The API never stores the key itself.
 */
export const WEBSITE_KEY_HEADER = 'x-must-website-key';
export const VISITOR_ADDRESS_HEADER = 'x-must-visitor-ip';

/** All of one website's visitors together may use this many times one visitor's limit: a backstop. */
export const HOTEL_CEILING_FACTOR = 20;

type Headers = Record<string, string | string[] | undefined>;

export function trustedVisitorAddress(
  headers: Headers | undefined,
  propertyId: string | undefined,
  configured: string | undefined = process.env.WEBSITE_CLIENT_KEYS,
): string | null {
  const key = headers?.[WEBSITE_KEY_HEADER];
  const address = headers?.[VISITOR_ADDRESS_HEADER];
  if (typeof key !== 'string' || typeof address !== 'string' || !propertyId || !configured)
    return null;
  if (key.length < 32 || !isIP(address)) return null;
  const given = createHash('sha256').update(key).digest();
  const known = configured.split(',').some((pair) => {
    const [property, hash] = pair.trim().split(':');
    if (property !== propertyId || !/^[0-9a-f]{64}$/i.test(hash ?? '')) return false;
    return timingSafeEqual(given, Buffer.from(hash!, 'hex'));
  });
  return known ? address.toLowerCase() : null;
}
