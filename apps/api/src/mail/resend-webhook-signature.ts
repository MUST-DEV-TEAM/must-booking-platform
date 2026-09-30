import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

/**
 * Verifies a Resend (Svix) webhook signature: HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * with the base64 part of the `whsec_...` secret, compared in constant time against every
 * `v1,<signature>` in the header (several are sent while a secret is being rotated). Also rejects
 * timestamps outside the tolerance window so a captured request cannot be replayed later.
 */
export function verifyResendWebhookSignature(
  rawBody: Buffer | string,
  headers: SvixHeaders,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  if (Math.abs(nowMs / 1000 - timestampSeconds) > toleranceSeconds) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length === 0) return false;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(' ').some((candidate) => {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) return false;
    const provided = Buffer.from(value, 'base64');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}
