import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Agent, request as undiciRequest } from 'undici';

import { buildDigestAuthorizationHeader, parseDigestChallenge } from './clock-digest-auth';

// This is the ONLY module allowed to make outbound HTTP calls to Clock
// (source brief section 9: "controllers/use-cases must never call Clock
// directly"). Rate limiting, circuit breaking, and the retry policy are
// layered on top of this in Task 5 — this module's job is strictly the
// authenticated call itself: connection pooling, TLS verification,
// configurable timeouts, and never logging credentials.

export interface ClockConnectionCredentials {
  host: string; // e.g. "sky-eu1.clock-software.com" (CONFIRMED_IN_SANDBOX shape)
  accountId: string; // first URL path segment, e.g. "172528"
  subscriptionId: string; // second URL path segment, e.g. "16307"
  apiUser: string;
  apiKey: string;
}

export type ClockApiFamily = 'pms_api' | 'base_api';

export interface ClockRequestOptions {
  api: ClockApiFamily;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // e.g. "/room_types" — leading slash, no query string
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ClockResponse<T = unknown> {
  status: number;
  body: T;
}

export class ClockHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClockHttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class ClockHttpClient implements OnModuleDestroy {
  private readonly logger = new Logger(ClockHttpClient.name);
  // One pooled, keep-alive agent shared across every Clock call in the
  // process — this is the actual "connection pooling" requirement; a fresh
  // Agent per request would mean a fresh TCP+TLS handshake every time.
  private readonly agent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 10,
    connect: { rejectUnauthorized: true },
  });

  // Always 'https:' in production (Clock has no plaintext endpoint) — the
  // constructor param exists only so unit tests can point this client at a
  // local plain-HTTP mock server without standing up a self-signed TLS cert.
  // Real TLS verification is exercised for real in Task 6 against the actual
  // Clock sandbox, which only speaks HTTPS.
  constructor(private readonly protocol: 'https:' | 'http:' = 'https:') {}

  async request<T = unknown>(
    credentials: ClockConnectionCredentials,
    options: ClockRequestOptions,
  ): Promise<ClockResponse<T>> {
    const url = this.buildUrl(credentials, options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestPath = url.pathname + url.search;

    const challengeAttempt = await this.send(url, options, undefined, timeoutMs);
    if (challengeAttempt.statusCode !== 401) {
      return this.readResponse<T>(challengeAttempt, url, options.method);
    }

    const wwwAuthenticate = headerValue(challengeAttempt.headers['www-authenticate']);
    const challenge = wwwAuthenticate ? parseDigestChallenge(wwwAuthenticate) : null;
    if (!challenge) {
      this.logger.warn(
        `Clock ${options.method} ${requestPath} returned 401 without a Digest challenge.`,
      );
      return this.readResponse<T>(challengeAttempt, url, options.method);
    }

    const authorization = buildDigestAuthorizationHeader({
      username: credentials.apiUser,
      password: credentials.apiKey,
      method: options.method,
      uri: requestPath,
      challenge,
    });
    // Never log the Authorization header (contains the Digest response hash,
    // derived from the API key) or the raw credentials — only the request shape.
    this.logger.debug(`Clock ${options.method} ${requestPath} (Digest-authenticated)`);
    const authenticated = await this.send(url, options, authorization, timeoutMs);
    return this.readResponse<T>(authenticated, url, options.method);
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent.close();
  }

  private async send(
    url: URL,
    options: ClockRequestOptions,
    authorization: string | undefined,
    timeoutMs: number,
  ) {
    try {
      return await undiciRequest(url, {
        method: options.method,
        dispatcher: this.agent,
        headers: {
          accept: 'application/json',
          ...(authorization ? { authorization } : {}),
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
    } catch (error) {
      throw new ClockHttpError(
        `Unable to reach Clock (${options.method} ${url.pathname}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        undefined,
        error,
      );
    }
  }

  private async readResponse<T>(
    response: Awaited<ReturnType<typeof undiciRequest>>,
    url: URL,
    method: string,
  ): Promise<ClockResponse<T>> {
    const text = await response.body.text();
    this.logger.log(`Clock ${method} ${url.pathname} -> ${response.statusCode}`);
    if (!text) return { status: response.statusCode, body: undefined as T };
    try {
      return { status: response.statusCode, body: JSON.parse(text) as T };
    } catch {
      // Clock returns HTML for some non-JSON error pages (e.g. 404s) — surface
      // the raw text rather than throwing, callers decide what a given status means.
      return { status: response.statusCode, body: text as unknown as T };
    }
  }

  private buildUrl(credentials: ClockConnectionCredentials, options: ClockRequestOptions): URL {
    const base = `${this.protocol}//${credentials.host}/${options.api}/${credentials.accountId}/${credentials.subscriptionId}${options.path}`;
    const url = new URL(base);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, value);
    return url;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
