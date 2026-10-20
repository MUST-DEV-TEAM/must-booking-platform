import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialCipherService } from '../integrations/credential-cipher';
import {
  issueSenderVerificationCode,
  matchesSenderVerificationCode,
  senderVerificationId,
  SenderVerificationBinding,
  SenderVerificationPayloadService,
  SenderVerificationSecretError,
} from './sender-verification-secrets';

const binding: SenderVerificationBinding = {
  tenantId: randomUUID(),
  propertyId: randomUUID(),
  verificationId: randomUUID(),
  credentialRevision: randomUUID(),
  fromAddress: 'hotel@example.test',
  expiresAt: '2026-10-20T12:30:00.000Z',
};
const changedBindings = (): SenderVerificationBinding[] => [
  { ...binding, tenantId: randomUUID() },
  { ...binding, propertyId: randomUUID() },
  { ...binding, verificationId: randomUUID() },
  { ...binding, credentialRevision: randomUUID() },
  { ...binding, fromAddress: 'other@example.test' },
  { ...binding, expiresAt: '2026-10-20T12:30:00.001Z' },
];

describe('sender mailbox proof secrets', () => {
  it('issues independent canonical 256-bit secrets and accepts only the matching bound code', () => {
    const first = issueSenderVerificationCode(binding);
    const second = issueSenderVerificationCode(binding);
    expect(first.code === second.code).toBe(false);
    expect(first.hash === second.hash).toBe(false);
    expect(senderVerificationId(first.code)).toBe(binding.verificationId);
    expect(first.code.length).toBe(80);
    expect(matchesSenderVerificationCode(binding, first.code, first.hash)).toBe(true);
    expect(matchesSenderVerificationCode(binding, `  ${first.code}\n`, first.hash)).toBe(true);
    expect(matchesSenderVerificationCode(binding, second.code, first.hash)).toBe(false);
    for (const changed of changedBindings())
      expect(matchesSenderVerificationCode(changed, first.code, first.hash)).toBe(false);
    // Object insertion order is irrelevant to the binding.
    expect(
      matchesSenderVerificationCode(
        {
          expiresAt: binding.expiresAt,
          fromAddress: binding.fromAddress,
          credentialRevision: binding.credentialRevision,
          verificationId: binding.verificationId,
          propertyId: binding.propertyId,
          tenantId: binding.tenantId,
        },
        first.code,
        first.hash,
      ),
    ).toBe(true);
  });

  it('rejects malformed, oversized, noncanonical and wrong-size hashes without exposing the input', () => {
    const issued = issueSenderVerificationCode(binding);
    const secret = issued.code.split('.')[1];
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(
      secret.at(-1)!,
    );
    const alias = `${binding.verificationId}.${secret.slice(0, -1)}${'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[index + 1]}`;
    for (const code of [
      '',
      'a'.repeat(101),
      `${issued.code}=`,
      issued.code.replace('.', '\n'),
      `${binding.verificationId}.${secret.slice(1)}`,
      alias,
    ]) {
      expect(senderVerificationId(code)).toBeNull();
      expect(matchesSenderVerificationCode(binding, code, issued.hash)).toBe(false);
    }
    for (const hash of ['', '0'.repeat(62), '0'.repeat(66), 'z'.repeat(64)])
      expect(matchesSenderVerificationCode(binding, issued.code, hash)).toBe(false);
  });

  it('rejects invalid scope/address/expiry rather than creating loosely bound secrets', () => {
    for (const changed of [
      { ...binding, tenantId: '' },
      { ...binding, propertyId: 'not-a-uuid' },
      { ...binding, verificationId: '' },
      { ...binding, credentialRevision: '' },
      { ...binding, fromAddress: 'Hotel@example.test' },
      { ...binding, fromAddress: 'hotel@example.test\r\nBcc: other@example.test' },
      { ...binding, expiresAt: 'not-a-date' },
      { ...binding, expiresAt: '2026-10-20T12:30:00Z' },
    ])
      expect(() => issueSenderVerificationCode(changed)).toThrow(SenderVerificationSecretError);
  });
});

describe('immutable encrypted sender verification email', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.INTEGRATION_CREDENTIALS_KEY;
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 29).toString('base64');
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
    else process.env.INTEGRATION_CREDENTIALS_KEY = originalKey;
  });
  const cipher = new CredentialCipherService();
  const payload = new SenderVerificationPayloadService(cipher);
  const message = () => {
    const issued = issueSenderVerificationCode(binding);
    return {
      subject: 'Verify your hotel sender',
      html: `<p>${issued.code}</p>`,
      text: `Verification code: ${issued.code}`,
    };
  };

  it('round-trips the exact prepared message with randomized authenticated ciphertext', () => {
    const prepared = message();
    const first = payload.seal(binding, prepared);
    const second = payload.seal(binding, prepared);
    expect(first === second).toBe(false);
    expect(Buffer.from(first, 'base64').includes(Buffer.from(prepared.text))).toBe(false);
    // Compare booleans so failed assertions do not print a verification secret.
    expect(JSON.stringify(payload.open(binding, first)) === JSON.stringify(prepared)).toBe(true);
  });

  it('rejects scope, revision, address, expiry and ciphertext changes', () => {
    const encrypted = payload.seal(binding, message());
    for (const changed of changedBindings())
      expect(() => payload.open(changed, encrypted)).toThrow(SenderVerificationSecretError);
    const tampered = Buffer.from(encrypted, 'base64');
    tampered[20] ^= 1;
    expect(() => payload.open(binding, tampered.toString('base64'))).toThrow(
      SenderVerificationSecretError,
    );
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 30).toString('base64');
    expect(() => payload.open(binding, encrypted)).toThrow(SenderVerificationSecretError);
  });

  it('rejects other encrypted payload purposes and malformed decrypted contents', () => {
    for (const invalid of [
      { ...binding, payloadKind: 'property-email-credentials-v1', ...message() },
      { ...binding, payloadKind: 'property-sender-verification-v1', ...message(), text: '' },
      {
        ...binding,
        payloadKind: 'property-sender-verification-v1',
        ...message(),
        subject: '\nBcc:x',
      },
    ])
      expect(() => payload.open(binding, cipher.encrypt(invalid))).toThrow(
        SenderVerificationSecretError,
      );
    expect(() => payload.open(binding, 'invalid ciphertext')).toThrow(
      SenderVerificationSecretError,
    );
  });

  it('whitelists message fields so caller extras cannot override the authenticated scope', () => {
    const prepared = {
      ...message(),
      tenantId: randomUUID(),
      payloadKind: 'other',
      to: 'other@test',
    };
    const encrypted = payload.seal(binding, prepared);
    const actual = payload.open(binding, encrypted);
    expect(Object.keys(actual).sort()).toEqual(['html', 'subject', 'text']);
    expect(
      JSON.stringify(actual) ===
        JSON.stringify({
          subject: prepared.subject,
          html: prepared.html,
          text: prepared.text,
        }),
    ).toBe(true);
    expect(cipher.decrypt(encrypted).tenantId === binding.tenantId).toBe(true);
  });

  it('rejects empty/header-injected/oversized messages with a fixed sanitized error', () => {
    for (const changed of [
      { ...message(), subject: '' },
      { ...message(), subject: 'x'.repeat(201) },
      { ...message(), subject: 'bad\r\nheader' },
      { ...message(), html: 'ë'.repeat(64_001) },
      { ...message(), text: 'ë'.repeat(32_001) },
    ])
      expect(() => payload.seal(binding, changed)).toThrow(SenderVerificationSecretError);
  });
});
