import { SetMetadata } from '@nestjs/common';

export const PUBLIC_RATE_LIMIT = 'public-rate-limit';

export type PublicRateLimitOptions = {
  /** Stable name used in the Redis key; never derive it from a caller-controlled URL. */
  name: string;
  maximum: number;
  windowSeconds: number;
  /** Route param that scopes the window (e.g. one Clock connection) instead of
   * the peer address, which behind the reverse proxy is the same for everyone. */
  scopeParam?: string;
};

/**
 * Limits anonymous, internet-facing routes independently from staff traffic.
 * The guard uses the socket peer address instead of forwarded headers, matching
 * the signup limiter's spoofing-safe behaviour.
 */
export const PublicRateLimit = (options: PublicRateLimitOptions): MethodDecorator =>
  SetMetadata(PUBLIC_RATE_LIMIT, options);

export const PUBLIC_READ_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'read',
  maximum: 120,
  windowSeconds: 60,
};

/**
 * The calendar has its own window: a website showing every room type asks once per room type and month
 * (26 calls for two months of a 13-type hotel), and all of a hotel's visitors currently share one window
 * because the API only sees the proxy's address. In the shared 'read' window that also turned away the
 * room list and prices (Empire, 2026-11-27). Most calls are answered from the 20-minute calendar memory;
 * Clock itself stays protected by the Clock API limiter.
 */
export const PUBLIC_CALENDAR_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'calendar',
  maximum: 600,
  windowSeconds: 60,
};

export const PUBLIC_QUOTE_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'quote',
  maximum: 20,
  windowSeconds: 60,
};

/**
 * One call checks several shifted stays (up to six provider lookups, mostly answered from the price memory),
 * so it has its own, tighter window than a single quote.
 */
export const PUBLIC_ALTERNATIVE_DATES_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'alternative-dates',
  maximum: 10,
  windowSeconds: 60,
};

export const PUBLIC_BOOKING_MUTATION_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'booking-mutation',
  maximum: 10,
  windowSeconds: 60,
};

export const PUBLIC_WEBHOOK_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'webhook',
  maximum: 120,
  windowSeconds: 60,
};

// Clock delivers through Amazon SNS in bursts (about 18,000 notifications on
// 2026-10-02, mostly folio updates), so one shared 120/minute window turned
// most of them away. Every notification is still SNS-signature verified, and
// hydration is paced separately by the 4/s Clock API limiter.
export const CLOCK_WEBHOOK_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'clock-webhook',
  maximum: 1_200,
  windowSeconds: 60,
  scopeParam: 'webhookPublicId',
};

// Stripe retries failed deliveries and sends one event per payment step; every call is still
// signature verified against the hotel's own webhook secret before anything is read.
export const STRIPE_WEBHOOK_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'stripe-webhook',
  maximum: 600,
  windowSeconds: 60,
  scopeParam: 'webhookPublicId',
};
