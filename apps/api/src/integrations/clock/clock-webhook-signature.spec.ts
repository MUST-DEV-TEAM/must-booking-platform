import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalString,
  isFreshTimestamp,
  isTrustedAwsHost,
  isTrustedCertUrl,
  verifySnsSignature,
  type SnsEnvelope,
} from './clock-webhook-signature';

function signEnvelope(envelope: SnsEnvelope, privateKey: string): string {
  const canonicalString = buildCanonicalString(envelope);
  const algorithm = envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const signer = createSign(algorithm);
  signer.update(canonicalString, 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
}

describe('buildCanonicalString', () => {
  it('orders fields alphabetically and includes only fields present on the message', () => {
    const notification: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm1',
      TopicArn: 'arn:aws:sns:eu-west-1:1:topic',
      Message: 'hello',
      Timestamp: '2026-08-04T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };

    expect(buildCanonicalString(notification)).toBe(
      'Message\nhello\n' +
        'MessageId\nm1\n' +
        'Timestamp\n2026-08-04T00:00:00.000Z\n' +
        'TopicArn\narn:aws:sns:eu-west-1:1:topic\n' +
        'Type\nNotification\n',
    );
  });

  it('includes Subject only when present, in its alphabetical position', () => {
    const withSubject: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm1',
      TopicArn: 'arn',
      Subject: 'A subject',
      Message: 'hello',
      Timestamp: 't',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };

    expect(buildCanonicalString(withSubject)).toBe(
      'Message\nhello\nMessageId\nm1\nSubject\nA subject\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n',
    );
  });
});

describe('verifySnsSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('accepts a genuinely valid signature (SignatureVersion 1, RSA-SHA1)', () => {
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm1',
      TopicArn: 'arn:aws:sns:eu-west-1:1:topic',
      Message: '{"booking_id":123}',
      Timestamp: '2026-08-04T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: '',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };
    envelope.Signature = signEnvelope(
      envelope,
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );

    expect(verifySnsSignature(envelope, certPem)).toBe(true);
  });

  it('accepts a genuinely valid signature (SignatureVersion 2, RSA-SHA256)', () => {
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm2',
      TopicArn: 'arn:aws:sns:eu-west-1:1:topic',
      Message: '{"booking_id":456}',
      Timestamp: '2026-08-04T00:00:00.000Z',
      SignatureVersion: '2',
      Signature: '',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };
    envelope.Signature = signEnvelope(
      envelope,
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );

    expect(verifySnsSignature(envelope, certPem)).toBe(true);
  });

  it('rejects a message whose Message field was tampered with after signing', () => {
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm3',
      TopicArn: 'arn:aws:sns:eu-west-1:1:topic',
      Message: '{"booking_id":123}',
      Timestamp: '2026-08-04T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: '',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };
    envelope.Signature = signEnvelope(
      envelope,
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );
    const tampered = { ...envelope, Message: '{"booking_id":999}' };

    expect(verifySnsSignature(tampered, certPem)).toBe(false);
  });

  it('rejects a signature produced by a different key pair', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm4',
      TopicArn: 'arn',
      Message: 'hello',
      Timestamp: 't',
      SignatureVersion: '1',
      Signature: '',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };
    envelope.Signature = signEnvelope(
      envelope,
      other.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );

    expect(verifySnsSignature(envelope, certPem)).toBe(false);
  });

  it('rejects malformed base64 signatures without throwing', () => {
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm5',
      TopicArn: 'arn',
      Message: 'hello',
      Timestamp: 't',
      SignatureVersion: '1',
      Signature: 'not-a-real-signature',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    };

    expect(verifySnsSignature(envelope, certPem)).toBe(false);
  });
});

describe('isTrustedCertUrl', () => {
  it('accepts a real AWS SNS cert URL shape', () => {
    expect(
      isTrustedCertUrl('https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc123.pem'),
    ).toBe(true);
  });

  it('rejects a non-AWS host (SSRF protection)', () => {
    expect(isTrustedCertUrl('https://evil.example.com/sns.eu-west-1.amazonaws.com.pem')).toBe(
      false,
    );
  });

  it('rejects a plain-http URL even on a trusted host', () => {
    expect(isTrustedCertUrl('http://sns.eu-west-1.amazonaws.com/cert.pem')).toBe(false);
  });

  it('rejects a trusted host serving a non-.pem path', () => {
    expect(isTrustedCertUrl('https://sns.eu-west-1.amazonaws.com/not-a-cert')).toBe(false);
  });

  it('rejects a malformed URL without throwing', () => {
    expect(isTrustedCertUrl('not a url')).toBe(false);
  });
});

describe('isTrustedAwsHost', () => {
  it('accepts a real AWS SNS confirmation URL (not a .pem path)', () => {
    expect(
      isTrustedAwsHost(
        'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn&Token=abc',
      ),
    ).toBe(true);
  });

  it('rejects a non-AWS host (SSRF protection)', () => {
    expect(isTrustedAwsHost('https://evil.example.com/?Action=ConfirmSubscription')).toBe(false);
  });
});

describe('isFreshTimestamp', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');

  it('accepts a timestamp from a few seconds ago', () => {
    expect(isFreshTimestamp('2026-08-04T11:59:55.000Z', now)).toBe(true);
  });

  it('rejects a timestamp older than the replay window', () => {
    expect(isFreshTimestamp('2026-08-04T11:00:00.000Z', now)).toBe(false);
  });

  it('rejects a timestamp far in the future', () => {
    expect(isFreshTimestamp('2026-08-04T12:10:00.000Z', now)).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(isFreshTimestamp('not-a-date', now)).toBe(false);
  });
});
