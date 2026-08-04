import { Inject, Injectable } from '@nestjs/common';

import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
  classifyConfigurationError,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

export interface ClockPingResult {
  ok: boolean;
  message: string;
}

const REQUIRED_CREDENTIAL_FIELDS: Array<keyof ClockConnectionCredentials> = [
  'host',
  'accountId',
  'subscriptionId',
  'apiUser',
  'apiKey',
];

/**
 * The one place that actually calls Clock through the full stack (client +
 * rate limiter + circuit breaker), used by both the tenant-facing "test
 * connection" button (ConnectionTestRegistry, Task 2) and
 * ClockPmsProvider.testConnection (the formal PmsProvider interface).
 * /room_types was chosen as the ping endpoint because it's CONFIRMED_IN_SANDBOX
 * to return 200 for this API user — see docs/CLOCK_ENDPOINT_MATRIX.md.
 */
@Injectable()
export class ClockConnectionPingService {
  constructor(
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async ping(rawCredentials: Record<string, string>): Promise<ClockPingResult> {
    const credentials = this.parseCredentials(rawCredentials);
    if (!credentials.ok) return { ok: false, message: credentials.message };

    const breakerKey = credentials.value.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError) return { ok: false, message: error.message };
      throw error;
    }

    const rateLimit = await this.rateLimiter.consume(credentials.value.apiUser);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        message: `Too many Clock requests for this connection right now — try again in ${rateLimit.retryAfterSeconds}s.`,
      };
    }

    try {
      const response = await this.client.request(credentials.value, {
        api: 'pms_api',
        method: 'GET',
        path: '/room_types',
        timeoutMs: 10_000,
      });

      if (response.status >= 200 && response.status < 300) {
        this.circuitBreaker.recordSuccess(breakerKey);
        return { ok: true, message: 'Connected to Clock successfully.' };
      }

      this.circuitBreaker.recordFailure(breakerKey);
      const classified = classifyClockHttpResponse(response.status, response.body);
      return { ok: false, message: classified.message };
    } catch (error) {
      this.circuitBreaker.recordFailure(breakerKey);
      if (error instanceof ClockHttpError) {
        const classified = classifyClockClientFailure('network', error.message);
        return { ok: false, message: classified.message };
      }
      throw error;
    }
  }

  private parseCredentials(
    rawCredentials: Record<string, string>,
  ): { ok: true; value: ClockConnectionCredentials } | { ok: false; message: string } {
    const missing = REQUIRED_CREDENTIAL_FIELDS.filter((field) => !rawCredentials[field]?.trim());
    if (missing.length > 0) {
      return {
        ok: false,
        message: classifyConfigurationError(
          `Missing required Clock credential field(s): ${missing.join(', ')}.`,
        ).message,
      };
    }
    return {
      ok: true,
      value: {
        host: rawCredentials.host.trim(),
        accountId: rawCredentials.accountId.trim(),
        subscriptionId: rawCredentials.subscriptionId.trim(),
        apiUser: rawCredentials.apiUser.trim(),
        apiKey: rawCredentials.apiKey,
      },
    };
  }
}
