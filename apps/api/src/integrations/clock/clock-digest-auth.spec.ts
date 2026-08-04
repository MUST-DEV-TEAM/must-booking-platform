import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildDigestAuthorizationHeader, parseDigestChallenge } from './clock-digest-auth';

describe('parseDigestChallenge', () => {
  it('parses the exact challenge shape confirmed against the real Clock sandbox', () => {
    const challenge = parseDigestChallenge(
      'Digest realm="API", qop="auth", algorithm=MD5, nonce="MTc4NTg0MTgzMzoz", opaque="1343089ccb88aaae"',
    );
    expect(challenge).toEqual({
      realm: 'API',
      nonce: 'MTc4NTg0MTgzMzoz',
      opaque: '1343089ccb88aaae',
      algorithm: 'MD5',
      qop: 'auth',
    });
  });

  it('returns null for a non-Digest challenge', () => {
    expect(parseDigestChallenge('Basic realm="API"')).toBeNull();
  });

  it('returns null when realm or nonce is missing', () => {
    expect(parseDigestChallenge('Digest qop="auth", algorithm=MD5')).toBeNull();
  });
});

describe('buildDigestAuthorizationHeader', () => {
  const challenge = {
    realm: 'API',
    nonce: 'test-nonce',
    opaque: 'test-opaque',
    algorithm: 'MD5',
    qop: 'auth',
  };

  it('computes the response hash per RFC 2617 (qop=auth) — verified by recomputing independently', () => {
    const header = buildDigestAuthorizationHeader({
      username: 'must_16307',
      password: 'secret-key',
      method: 'GET',
      uri: '/pms_api/172528/16307/room_types',
      challenge,
      nonceCount: 1,
    });

    const nc = /nc=(\w+)/.exec(header)![1];
    const cnonce = /cnonce="([^"]+)"/.exec(header)![1];
    const response = /response="([^"]+)"/.exec(header)![1];

    const md5 = (input: string) => createHash('md5').update(input).digest('hex');
    const ha1 = md5(`must_16307:API:secret-key`);
    const ha2 = md5(`GET:/pms_api/172528/16307/room_types`);
    const expected = md5(`${ha1}:test-nonce:${nc}:${cnonce}:auth:${ha2}`);

    expect(response).toBe(expected);
    expect(header).toContain('username="must_16307"');
    expect(header).toContain('realm="API"');
    expect(header).toContain('opaque="test-opaque"');
    expect(header).toContain('algorithm=MD5');
    expect(header).not.toContain('secret-key');
  });

  it('generates a different cnonce (and therefore a different response hash) on each call', () => {
    const first = buildDigestAuthorizationHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/x',
      challenge,
    });
    const second = buildDigestAuthorizationHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/x',
      challenge,
    });
    expect(first).not.toBe(second);
  });

  it('omits opaque when the challenge did not provide one', () => {
    const header = buildDigestAuthorizationHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/x',
      challenge: { ...challenge, opaque: undefined },
    });
    expect(header).not.toContain('opaque=');
  });
});
