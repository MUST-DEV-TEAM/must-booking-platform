import { SetMetadata } from '@nestjs/common';

export const PUBLIC_RATE_LIMIT = 'public-rate-limit';

export type PublicRateLimitOptions = {
  /** Stable name used in the Redis key; never derive it from a caller-controlled URL. */
  name: string;
  maximum: number;
  windowSeconds: number;
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

export const PUBLIC_QUOTE_RATE_LIMIT: PublicRateLimitOptions = {
  name: 'quote',
  maximum: 20,
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
