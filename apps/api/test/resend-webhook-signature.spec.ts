import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyResendWebhookSignature } from '../src/mail/resend-webhook-signature';

const keyBytes = Buffer.from('0123456789abcdef0123456789abcdef');
const secret = `whsec_${keyBytes.toString('base64')}`;
const nowMs = Date.UTC(2026, 8, 30, 12, 0, 0);
const timestamp = String(Math.floor(nowMs / 1000));
const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc' } });

function sign(id: string, ts: string, payload: string, key: Buffer = keyBytes): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`;
}

describe('verifyResendWebhookSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    expect(
      verifyResendWebhookSignature(
        Buffer.from(body),
        { id: 'msg_1', timestamp, signature: sign('msg_1', timestamp, body) },
        secret,
        nowMs,
      ),
    ).toBe(true);
  });

  it('accepts when any one of several rotated signatures matches', () => {
    const rotated = `${sign('msg_1', timestamp, body, Buffer.from('some-old-secret-bytes-0000000000'))} ${sign('msg_1', timestamp, body)}`;
    expect(
      verifyResendWebhookSignature(
        body,
        { id: 'msg_1', timestamp, signature: rotated },
        secret,
        nowMs,
      ),
    ).toBe(true);
  });

  it('rejects a tampered body, wrong secret, wrong id or missing headers', () => {
    const signature = sign('msg_1', timestamp, body);
    expect(
      verifyResendWebhookSignature(
        body + ' ',
        { id: 'msg_1', timestamp, signature },
        secret,
        nowMs,
      ),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature(
        body,
        { id: 'msg_1', timestamp, signature },
        `whsec_${Buffer.from('a-completely-different-secret!!').toString('base64')}`,
        nowMs,
      ),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature(body, { id: 'msg_2', timestamp, signature }, secret, nowMs),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature(body, { id: undefined, timestamp, signature }, secret, nowMs),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature(
        body,
        { id: 'msg_1', timestamp, signature: undefined },
        secret,
        nowMs,
      ),
    ).toBe(false);
  });

  it('rejects a replayed request whose timestamp is outside the tolerance window', () => {
    const old = String(Math.floor(nowMs / 1000) - 10 * 60);
    expect(
      verifyResendWebhookSignature(
        body,
        { id: 'msg_1', timestamp: old, signature: sign('msg_1', old, body) },
        secret,
        nowMs,
      ),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature(
        body,
        { id: 'msg_1', timestamp: 'not-a-number', signature: sign('msg_1', 'not-a-number', body) },
        secret,
        nowMs,
      ),
    ).toBe(false);
  });

  it('ignores non-v1 signature versions', () => {
    const v2 = sign('msg_1', timestamp, body).replace('v1,', 'v2,');
    expect(
      verifyResendWebhookSignature(body, { id: 'msg_1', timestamp, signature: v2 }, secret, nowMs),
    ).toBe(false);
  });
});
