import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { buildCanonicalString, type SnsEnvelope } from './clock-webhook-signature';
import { ClockWebhookVerificationService } from './clock-webhook-verification.service';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function signedEnvelope(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  const envelope: SnsEnvelope = {
    Type: 'Notification',
    MessageId: 'm1',
    TopicArn: 'arn:aws:sns:eu-west-1:1:topic',
    Message: '{"booking_id":123}',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: '',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem',
    ...overrides,
  };
  const signer = createSign('RSA-SHA1');
  signer.update(buildCanonicalString(envelope), 'utf8');
  signer.end();
  envelope.Signature = signer.sign(privatePem, 'base64');
  return envelope;
}

describe('ClockWebhookVerificationService.verify', () => {
  it('accepts a genuinely valid, fresh, trusted-host message end-to-end', async () => {
    const fetchCert = vi.fn().mockResolvedValue(certPem);
    const service = new ClockWebhookVerificationService(fetchCert);

    const result = await service.verify(signedEnvelope());

    expect(result).toEqual({ ok: true });
    expect(fetchCert).toHaveBeenCalledWith(
      'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem',
    );
  });

  it('caches the fetched cert across multiple verifications of the same URL', async () => {
    const fetchCert = vi.fn().mockResolvedValue(certPem);
    const service = new ClockWebhookVerificationService(fetchCert);

    await service.verify(signedEnvelope({ MessageId: 'a' }));
    await service.verify(signedEnvelope({ MessageId: 'b' }));

    expect(fetchCert).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted SigningCertURL without ever fetching it', async () => {
    const fetchCert = vi.fn();
    const service = new ClockWebhookVerificationService(fetchCert);

    const result = await service.verify(
      signedEnvelope({ SigningCertURL: 'https://evil.example.com/cert.pem' }),
    );

    expect(result.ok).toBe(false);
    expect(fetchCert).not.toHaveBeenCalled();
  });

  it('rejects a stale (replayed) timestamp without fetching the cert', async () => {
    const fetchCert = vi.fn();
    const service = new ClockWebhookVerificationService(fetchCert);

    const result = await service.verify(
      signedEnvelope({ Timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    );

    expect(result.ok).toBe(false);
    expect(fetchCert).not.toHaveBeenCalled();
  });

  it('reports failure cleanly when the cert fetch itself fails, rather than throwing', async () => {
    const fetchCert = vi.fn().mockRejectedValue(new Error('network down'));
    const service = new ClockWebhookVerificationService(fetchCert);

    const result = await service.verify(signedEnvelope());

    expect(result).toEqual({ ok: false, reason: 'Could not fetch the SNS signing certificate.' });
  });

  it('rejects a tampered message even with a correctly-fetched trusted cert', async () => {
    const fetchCert = vi.fn().mockResolvedValue(certPem);
    const service = new ClockWebhookVerificationService(fetchCert);
    const envelope = signedEnvelope();

    const result = await service.verify({ ...envelope, Message: '{"booking_id":999}' });

    expect(result).toEqual({ ok: false, reason: 'Signature verification failed.' });
  });
});
