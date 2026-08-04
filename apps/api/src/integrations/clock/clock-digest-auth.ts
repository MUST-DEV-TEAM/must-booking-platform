import { createHash, randomBytes } from 'node:crypto';

// CONFIRMED_IN_SANDBOX (Milestone 11 Task 4/6): Clock's real sandbox challenge
// is `Digest realm="API", qop="auth", algorithm=MD5, nonce="...", opaque="..."`
// — standard RFC 7616/2617 Digest with qop=auth, not a proprietary scheme.
// Verified 2026-08-04 against https://sky-eu1.clock-software.com.

export interface ClockDigestChallenge {
  realm: string;
  nonce: string;
  opaque?: string;
  algorithm: string;
  qop: string;
}

export function parseDigestChallenge(wwwAuthenticate: string): ClockDigestChallenge | null {
  if (!/^\s*digest\b/i.test(wwwAuthenticate)) return null;
  const realm = /realm="([^"]*)"/.exec(wwwAuthenticate)?.[1];
  const nonce = /nonce="([^"]*)"/.exec(wwwAuthenticate)?.[1];
  if (!realm || !nonce) return null;
  return {
    realm,
    nonce,
    opaque: /opaque="([^"]*)"/.exec(wwwAuthenticate)?.[1],
    algorithm: /algorithm=([\w-]+)/.exec(wwwAuthenticate)?.[1] ?? 'MD5',
    qop: /qop="?([\w-]+)"?/.exec(wwwAuthenticate)?.[1] ?? 'auth',
  };
}

export function buildDigestAuthorizationHeader(params: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: ClockDigestChallenge;
  nonceCount?: number;
}): string {
  const { username, password, method, uri, challenge } = params;
  const nc = String(params.nonceCount ?? 1).padStart(8, '0');
  const cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `qop=${challenge.qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  parts.push(`algorithm=${challenge.algorithm}`);
  return `Digest ${parts.join(', ')}`;
}

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}
