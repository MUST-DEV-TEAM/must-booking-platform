import { Injectable, Logger } from '@nestjs/common';

import {
  isFreshTimestamp,
  isTrustedAwsHost,
  isTrustedCertUrl,
  verifySnsSignature,
  type SnsEnvelope,
} from './clock-webhook-signature';

export type SnsVerificationResult = { ok: true } | { ok: false; reason: string };

const CERT_CACHE_TTL_MS = 60 * 60 * 1000; // Certs are long-lived; refetching per message would be wasteful.
const CERT_FETCH_TIMEOUT_MS = 10_000;

interface CacheEntry {
  pem: string;
  expiresAt: number;
}

/**
 * The only place allowed to fetch a signing cert. `fetchCert` is injectable
 * purely for tests (mirrors ClockHttpClient's `protocol` override) — real
 * callers never override it.
 */
@Injectable()
export class ClockWebhookVerificationService {
  private readonly logger = new Logger(ClockWebhookVerificationService.name);
  private readonly certCache = new Map<string, CacheEntry>();

  constructor(private readonly fetchCert: (url: string) => Promise<string> = defaultFetchCert) {}

  async verify(envelope: SnsEnvelope): Promise<SnsVerificationResult> {
    if (!isFreshTimestamp(envelope.Timestamp))
      return { ok: false, reason: 'Message timestamp is outside the accepted window.' };
    if (!isTrustedCertUrl(envelope.SigningCertURL))
      return { ok: false, reason: 'SigningCertURL is not a trusted AWS SNS host.' };

    let certPem: string;
    try {
      certPem = await this.certFor(envelope.SigningCertURL);
    } catch (error) {
      this.logger.warn(`Failed to fetch SNS signing cert: ${(error as Error).message}`);
      return { ok: false, reason: 'Could not fetch the SNS signing certificate.' };
    }

    return verifySnsSignature(envelope, certPem)
      ? { ok: true }
      : { ok: false, reason: 'Signature verification failed.' };
  }

  /** Used for SubscriptionConfirmation — same SSRF protection as the cert URL. */
  async confirmSubscription(subscribeUrl: string): Promise<boolean> {
    if (!isTrustedAwsHost(subscribeUrl)) return false;
    try {
      const response = await fetch(subscribeUrl, {
        signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS),
      });
      return response.ok;
    } catch (error) {
      this.logger.warn(`Failed to confirm SNS subscription: ${(error as Error).message}`);
      return false;
    }
  }

  private async certFor(url: string): Promise<string> {
    const cached = this.certCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.pem;
    const pem = await this.fetchCert(url);
    this.certCache.set(url, { pem, expiresAt: Date.now() + CERT_CACHE_TTL_MS });
    return pem;
  }
}

async function defaultFetchCert(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(CERT_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Signing cert fetch returned status ${response.status}.`);
  return response.text();
}
