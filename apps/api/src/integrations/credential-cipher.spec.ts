import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CredentialCipherService,
  CredentialDecryptionError,
  decryptCredentialPayload,
  encryptCredentialPayload,
  InvalidCredentialCipherKeyError,
} from './credential-cipher';

const key = randomBytes(32).toString('base64');
const originalKey = process.env.INTEGRATION_CREDENTIALS_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
  else process.env.INTEGRATION_CREDENTIALS_KEY = originalKey;
});

describe('encryptCredentialPayload / decryptCredentialPayload', () => {
  it('round-trips plaintext through encrypt then decrypt', () => {
    const plaintext = JSON.stringify({ apiUser: 'must_16307', apiKey: 'c79744f83d4b7887' });

    const encrypted = encryptCredentialPayload(plaintext, key);

    expect(encrypted).not.toContain('must_16307');
    expect(decryptCredentialPayload(encrypted, key)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const first = encryptCredentialPayload('same input', key);
    const second = encryptCredentialPayload('same input', key);

    expect(first).not.toBe(second);
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    expect(() => encryptCredentialPayload('value', 'dG9vLXNob3J0')).toThrow(
      InvalidCredentialCipherKeyError,
    );
  });

  it('fails to decrypt when the ciphertext has been tampered with', () => {
    const encrypted = encryptCredentialPayload('sensitive value', key);
    const tampered = Buffer.from(encrypted, 'base64');
    tampered[tampered.length - 1] ^= 0xff;

    expect(() => decryptCredentialPayload(tampered.toString('base64'), key)).toThrow(
      CredentialDecryptionError,
    );
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encryptCredentialPayload('sensitive value', key);
    const wrongKey = randomBytes(32).toString('base64');

    expect(() => decryptCredentialPayload(encrypted, wrongKey)).toThrow(CredentialDecryptionError);
  });
});

describe('CredentialCipherService', () => {
  it('round-trips a structured credential record via JSON', () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = key;
    const service = new CredentialCipherService();
    const credentials = { region: 'eu1', apiUser: 'must_16307', apiKey: 'c79744f83d4b7887' };

    const encrypted = service.encrypt(credentials);

    expect(encrypted).not.toContain('must_16307');
    expect(service.decrypt(encrypted)).toEqual(credentials);
  });

  it('throws when INTEGRATION_CREDENTIALS_KEY is not configured', () => {
    delete process.env.INTEGRATION_CREDENTIALS_KEY;
    const service = new CredentialCipherService();

    expect(() => service.encrypt({ a: 'b' })).toThrow(
      'INTEGRATION_CREDENTIALS_KEY must be configured.',
    );
  });
});
