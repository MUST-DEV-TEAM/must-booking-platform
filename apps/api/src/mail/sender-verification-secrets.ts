import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CredentialCipherService } from '../integrations/credential-cipher';

const PURPOSE = 'property-sender-verification-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export type SenderVerificationBinding = {
  tenantId: string;
  propertyId: string;
  verificationId: string;
  credentialRevision: string;
  fromAddress: string;
  expiresAt: string;
};
export type SenderVerificationMessage = { subject: string; html: string; text: string };

export class SenderVerificationSecretError extends Error {
  constructor() {
    super('Sender verification information is unavailable. Request a new verification email.');
    this.name = 'SenderVerificationSecretError';
  }
}

function fields(binding: SenderVerificationBinding): Record<string, string> {
  if (
    !UUID.test(binding.tenantId) ||
    !UUID.test(binding.propertyId) ||
    !UUID.test(binding.verificationId) ||
    !UUID.test(binding.credentialRevision) ||
    typeof binding.fromAddress !== 'string' ||
    binding.fromAddress.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+$/.test(binding.fromAddress) ||
    binding.fromAddress !== binding.fromAddress.toLowerCase() ||
    !Number.isFinite(Date.parse(binding.expiresAt)) ||
    new Date(binding.expiresAt).toISOString() !== binding.expiresAt
  )
    throw new SenderVerificationSecretError();
  return {
    payloadKind: PURPOSE,
    tenantId: binding.tenantId,
    propertyId: binding.propertyId,
    verificationId: binding.verificationId,
    credentialRevision: binding.credentialRevision,
    fromAddress: binding.fromAddress,
    expiresAt: binding.expiresAt,
  };
}

/** Strictly parses a copied code without returning its secret to callers. */
export function senderVerificationId(code: string): string | null {
  if (typeof code !== 'string' || code.length > 100) return null;
  const match = CODE.exec(code.trim());
  if (!match) return null;
  const raw = Buffer.from(match[2], 'base64url');
  return raw.length === 32 && raw.toString('base64url') === match[2] ? match[1] : null;
}

function digest(binding: SenderVerificationBinding, code: string): Buffer {
  // Explicit ordered fields avoid ambiguous delimiters and caller object ordering.
  return createHash('sha256')
    .update(JSON.stringify([Object.values(fields(binding)), code.trim()]))
    .digest();
}

/** Generates high-entropy mailbox proof; only its hash belongs in a challenge row. */
export function issueSenderVerificationCode(binding: SenderVerificationBinding): {
  code: string;
  hash: string;
} {
  fields(binding);
  const code = `${binding.verificationId}.${randomBytes(32).toString('base64url')}`;
  return { code, hash: digest(binding, code).toString('hex') };
}

/** Expiry/attempt/lifecycle checks belong to the transaction that consumes the proof. */
export function matchesSenderVerificationCode(
  binding: SenderVerificationBinding,
  code: string,
  expectedHash: string,
): boolean {
  try {
    if (
      senderVerificationId(code) !== binding.verificationId ||
      typeof expectedHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(expectedHash)
    )
      return false;
    return timingSafeEqual(digest(binding, code), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

function messageFields(message: SenderVerificationMessage): SenderVerificationMessage {
  if (
    typeof message.subject !== 'string' ||
    message.subject.length < 1 ||
    message.subject.length > 200 ||
    /[\r\n\0]/.test(message.subject) ||
    typeof message.html !== 'string' ||
    message.html.length < 1 ||
    Buffer.byteLength(message.html, 'utf8') > 128_000 ||
    typeof message.text !== 'string' ||
    message.text.length < 1 ||
    Buffer.byteLength(message.text, 'utf8') > 64_000
  )
    throw new SenderVerificationSecretError();
  return { subject: message.subject, html: message.html, text: message.text };
}

/** Encrypts the immutable security email, bound to its hotel, sender and challenge. */
@Injectable()
export class SenderVerificationPayloadService {
  constructor(@Inject(CredentialCipherService) private readonly cipher: CredentialCipherService) {}

  seal(binding: SenderVerificationBinding, message: SenderVerificationMessage): string {
    try {
      return this.cipher.encrypt({ ...fields(binding), ...messageFields(message) });
    } catch {
      throw new SenderVerificationSecretError();
    }
  }

  open(binding: SenderVerificationBinding, encrypted: string): SenderVerificationMessage {
    try {
      const expected = fields(binding);
      const payload = this.cipher.decrypt(encrypted);
      if (
        !payload ||
        typeof payload !== 'object' ||
        Object.entries(expected).some(([key, value]) => payload[key] !== value)
      )
        throw new SenderVerificationSecretError();
      return messageFields({ subject: payload.subject, html: payload.html, text: payload.text });
    } catch {
      throw new SenderVerificationSecretError();
    }
  }
}
