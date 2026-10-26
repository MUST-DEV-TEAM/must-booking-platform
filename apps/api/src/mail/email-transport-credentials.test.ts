import { afterEach, beforeEach, expect, it } from 'vitest';
import { CredentialCipherService } from '../integrations/credential-cipher';
import {
  EmailTransportCredentialService,
  EmailTransportCredentialError,
} from './email-transport-credentials';

let originalKey: string | undefined;
beforeEach(() => {
  originalKey = process.env.INTEGRATION_CREDENTIALS_KEY;
  process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 17).toString('base64');
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
  else process.env.INTEGRATION_CREDENTIALS_KEY = originalKey;
});
const scope = { tenantId: 'tenant-a', propertyId: 'hotel-a' },
  binding = {
    revision: 'revision-a',
    endpoint: 'smtp://smtp.gmail.com:587/STARTTLS/from=hotel@example.test',
  };
const smtp = { provider: 'smtp' as const, username: 'test-user', password: 'test-password' };
const service = () => new EmailTransportCredentialService(new CredentialCipherService());
it('encrypts real authenticated credentials with randomized ciphertext, never a readable payload', () => {
  const s = service(),
    first = s.seal(scope, binding, smtp),
    second = s.seal(scope, binding, smtp);
  expect(first).not.toBe(second);
  expect(first).not.toContain(smtp.password);
  expect(Buffer.from(first, 'base64').toString()).not.toContain(smtp.username);
  expect(s.open(scope, binding, first)).toEqual(smtp);
  const resend = { provider: 'resend' as const, apiKey: 're_test_only' };
  const sealed = s.seal(
    scope,
    { ...binding, endpoint: 'https://api.resend.com/domain/example.test' },
    resend,
  );
  expect(
    s.open(scope, { ...binding, endpoint: 'https://api.resend.com/domain/example.test' }, sealed),
  ).toEqual(resend);
});
it('rejects cross-tenant/property, replaced credentials, endpoint redirection and ciphertext tampering', () => {
  const s = service(),
    encrypted = s.seal(scope, binding, smtp);
  for (const otherScope of [
    { ...scope, tenantId: 'tenant-b' },
    { ...scope, propertyId: 'hotel-b' },
  ])
    expect(() => s.open(otherScope, binding, encrypted)).toThrow(EmailTransportCredentialError);
  for (const otherBinding of [
    { ...binding, revision: 'revision-b' },
    { ...binding, endpoint: 'smtp://attacker.example.test:587/STARTTLS' },
  ])
    expect(() => s.open(scope, otherBinding, encrypted)).toThrow(EmailTransportCredentialError);
  const tampered = Buffer.from(encrypted, 'base64');
  tampered[20] ^= 1;
  expect(() => s.open(scope, binding, tampered.toString('base64'))).toThrow(
    EmailTransportCredentialError,
  );
  expect(() => s.open(scope, binding, 'not ciphertext')).toThrow(EmailTransportCredentialError);
});
it('rejects other cipher payload types and invalid decrypted credential shapes', () => {
  const cipher = new CredentialCipherService(),
    s = service();
  const other = cipher.encrypt({ ...scope, ...binding, payloadKind: 'email-preview', ...smtp });
  expect(() => s.open(scope, binding, other)).toThrow(EmailTransportCredentialError);
  const invalid = cipher.encrypt({
    ...scope,
    ...binding,
    payloadKind: 'property-email-credentials-v1',
    provider: 'resend',
    apiKey: 'bad\r\nheader',
  });
  expect(() => s.open(scope, binding, invalid)).toThrow(EmailTransportCredentialError);
});
it('whitelists secret fields so extra input cannot overwrite the authenticated scope or payload kind', () => {
  const s = service(),
    extra = {
      ...smtp,
      tenantId: 'attacker',
      propertyId: 'other-hotel',
      revision: 'other',
      payloadKind: 'email-preview',
    };
  expect(s.open(scope, binding, s.seal(scope, binding, extra))).toEqual(smtp);
});
it('fails closed without encryption or valid scope/credentials and redacts failures', () => {
  const s = service();
  expect(() => s.seal({ ...scope, propertyId: '' }, binding, smtp)).toThrow(
    EmailTransportCredentialError,
  );
  expect(() => s.seal(scope, binding, { ...smtp, password: '' })).toThrow(
    EmailTransportCredentialError,
  );
  expect(() => s.seal(scope, binding, { provider: 'resend', apiKey: 'secret\nheader' })).toThrow(
    EmailTransportCredentialError,
  );
  delete process.env.INTEGRATION_CREDENTIALS_KEY;
  expect(() => s.seal(scope, binding, smtp)).toThrow(EmailTransportCredentialError);
});
