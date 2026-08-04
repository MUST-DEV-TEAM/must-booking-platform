import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM: authenticated encryption, so a tampered/corrupted ciphertext
// fails to decrypt (decipher.final() throws) rather than silently returning
// wrong bytes. First reversible-encryption primitive in this codebase — every
// existing sensitive-data pattern (bcrypt password hashes, HMAC-SHA256 quote
// signing) is one-way. Tenant integration credentials must be readable again
// to make outbound provider calls, so a one-way scheme cannot apply here.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

export class InvalidCredentialCipherKeyError extends Error {
  constructor() {
    super('INTEGRATION_CREDENTIALS_KEY must decode (base64) to exactly 32 bytes.');
    this.name = 'InvalidCredentialCipherKeyError';
  }
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super('Unable to decrypt integration credentials: ciphertext is invalid or was tampered with.');
    this.name = 'CredentialDecryptionError';
  }
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) throw new InvalidCredentialCipherKeyError();
  return key;
}

/** Encrypts a UTF-8 string, returning a single base64 blob: iv || authTag || ciphertext. */
export function encryptCredentialPayload(plaintext: string, keyBase64: string): string {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Inverse of encryptCredentialPayload. Throws CredentialDecryptionError on tamper/corruption. */
export function decryptCredentialPayload(encoded: string, keyBase64: string): string {
  const key = decodeKey(keyBase64);
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new CredentialDecryptionError();
  }
}

/**
 * Nest-injectable wrapper: encrypts/decrypts a provider credential payload
 * (an arbitrary string-keyed record — shape varies per provider) as JSON.
 */
@Injectable()
export class CredentialCipherService {
  encrypt(credentials: Record<string, string>): string {
    return encryptCredentialPayload(JSON.stringify(credentials), this.key());
  }

  decrypt(encryptedCredentials: string): Record<string, string> {
    return JSON.parse(decryptCredentialPayload(encryptedCredentials, this.key())) as Record<
      string,
      string
    >;
  }

  private key(): string {
    const configured = process.env.INTEGRATION_CREDENTIALS_KEY;
    if (!configured) throw new Error('INTEGRATION_CREDENTIALS_KEY must be configured.');
    return configured;
  }
}
