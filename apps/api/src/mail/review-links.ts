import { BadRequestException } from '@nestjs/common';

/**
 * Where guests can review a property (email plan Step 6). The post-stay thank-you
 * shows a button for each link that is set. Every guest gets the same links: Google
 * and the big review sites forbid sending only happy guests to public reviews.
 */
export const REVIEW_SITES = [
  { key: 'google', label: 'Review us on Google' },
  { key: 'tripadvisor', label: 'Review us on Tripadvisor' },
  { key: 'booking_com', label: 'Review us on Booking.com' },
  { key: 'facebook', label: 'Review us on Facebook' },
  { key: 'website', label: 'Review us on our website' },
  /** A private "tell us how we did" form, shown alongside the public sites. */
  { key: 'feedback', label: 'Send us private feedback' },
] as const;

export type ReviewSite = (typeof REVIEW_SITES)[number]['key'];
export type ReviewLinks = Partial<Record<ReviewSite, string>>;

const MAX_URL_LENGTH = 500;

/** Only known sites with https addresses; anything else stored is ignored. */
export function storedReviewLinks(value: unknown): ReviewLinks {
  const links: ReviewLinks = {};
  if (!value || typeof value !== 'object') return links;
  for (const site of REVIEW_SITES) {
    const url = (value as Record<string, unknown>)[site.key];
    if (typeof url === 'string' && isHttpsUrl(url)) links[site.key] = url;
  }
  return links;
}

/** Validates a full set of links from the settings screen; empty values clear a link. */
export function parseReviewLinks(body: unknown): ReviewLinks {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Send the review links as an object.');
  const known = new Set<string>(REVIEW_SITES.map((site) => site.key));
  const links: ReviewLinks = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!known.has(key)) throw new BadRequestException(`Unknown review site: ${key}.`);
    if (raw === null || raw === undefined || raw === '') continue;
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!url) continue;
    if (url.length > MAX_URL_LENGTH || !isHttpsUrl(url))
      throw new BadRequestException(
        `The ${key.replace('_', '.')} link must be a full https:// address.`,
      );
    links[key as ReviewSite] = url;
  }
  return links;
}

/** The buttons the email shows, in a fixed order. */
export function reviewButtons(links: ReviewLinks): Array<{ url: string; label: string }> {
  return REVIEW_SITES.filter((site) => links[site.key]).map((site) => ({
    url: links[site.key]!,
    label: site.label,
  }));
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch {
    return false;
  }
}
