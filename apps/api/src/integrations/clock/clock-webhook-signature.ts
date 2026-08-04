import { createVerify } from 'node:crypto';

// AWS SNS message signature verification (source brief section 20/27: "AWS
// SNS signature verification", not a custom HMAC scheme). Algorithm per
// AWS's own documentation: build a canonical string from a fixed set of
// fields (only the ones actually present on the message), each field, over
// that string using the RSA public key from SigningCertURL.
export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
  UnsubscribeURL?: string;
}

// Already alphabetically ordered — AWS's canonicalization rule is simply
// "these fields, alphabetically, when present."
const CANONICAL_FIELDS = [
  'Message',
  'MessageId',
  'Subject',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
] as const;

// Real AWS SNS cert-hosting pattern (e.g. https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-<hash>.pem).
// SSRF protection (source brief section 27): reject anything else before
// ever fetching it, regardless of what the message body claims.
const TRUSTED_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

/** Host+protocol check only — for SubscribeURL/UnsubscribeURL, which aren't `.pem` paths. */
export function isTrustedAwsHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && TRUSTED_CERT_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** SigningCertURL specifically — same host check, plus the real cert path shape. */
export function isTrustedCertUrl(url: string): boolean {
  if (!isTrustedAwsHost(url)) return false;
  return new URL(url).pathname.endsWith('.pem');
}

export function buildCanonicalString(envelope: SnsEnvelope): string {
  let result = '';
  for (const field of CANONICAL_FIELDS) {
    const value = (envelope as unknown as Record<string, string | undefined>)[field];
    if (value === undefined) continue;
    result += `${field}\n${value}\n`;
  }
  return result;
}

export function verifySnsSignature(envelope: SnsEnvelope, certPem: string): boolean {
  const algorithm = envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const canonicalString = buildCanonicalString(envelope);
  const verifier = createVerify(algorithm);
  verifier.update(canonicalString, 'utf8');
  verifier.end();
  try {
    return verifier.verify(certPem, envelope.Signature, 'base64');
  } catch {
    return false;
  }
}

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000; // Replay protection (source brief section 27).

export function isFreshTimestamp(timestamp: string, now: Date = new Date()): boolean {
  const messageTime = new Date(timestamp).getTime();
  if (Number.isNaN(messageTime)) return false;
  const ageMs = now.getTime() - messageTime;
  return ageMs >= -60_000 && ageMs <= MAX_MESSAGE_AGE_MS; // small future-skew allowance for clock drift
}
