import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';

const credentials: ClockConnectionCredentials = {
  host: '',
  accountId: '172528',
  subscriptionId: '16307',
  apiUser: 'must_16307',
  apiKey: 'sandbox-secret-key',
};
const NONCE = 'test-nonce-value';
const OPAQUE = 'test-opaque-value';

let server: Server | undefined;
let client: ClockHttpClient | undefined;

afterEach(async () => {
  await client?.onModuleDestroy();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  client = undefined;
});

describe('ClockHttpClient', () => {
  it('follows the Digest challenge/response round-trip and returns the JSON body', async () => {
    let secondRequestAuthorization: string | undefined;
    const host = await startMockServer((request, response) => {
      const authorization = request.headers.authorization;
      if (!authorization) {
        response.writeHead(401, {
          'www-authenticate': `Digest realm="API", qop="auth", algorithm=MD5, nonce="${NONCE}", opaque="${OPAQUE}"`,
        });
        response.end('HTTP Digest: Access denied.');
        return;
      }
      secondRequestAuthorization = authorization;
      const valid = verifyDigestResponse(authorization, {
        username: credentials.apiUser,
        password: credentials.apiKey,
        method: 'GET',
        uri: '/pms_api/172528/16307/room_types',
        realm: 'API',
        nonce: NONCE,
      });
      if (!valid) {
        response.writeHead(403);
        response.end('{"error":"invalid digest response"}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: 42023, name: 'Standard Rooms' }]));
    });

    client = new ClockHttpClient('http:');
    const result = await client.request(
      { ...credentials, host },
      { api: 'pms_api', method: 'GET', path: '/room_types' },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ id: 42023, name: 'Standard Rooms' }]);
    expect(secondRequestAuthorization).toContain('username="must_16307"');
    expect(secondRequestAuthorization).not.toContain('sandbox-secret-key');
  });

  it('never logs the API key or the Authorization header, even at debug level', async () => {
    const host = await startMockServer((request, response) => {
      if (!request.headers.authorization) {
        response.writeHead(401, {
          'www-authenticate': `Digest realm="API", qop="auth", algorithm=MD5, nonce="${NONCE}", opaque="${OPAQUE}"`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });

    const logSpy: string[] = [];
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      logSpy.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    client = new ClockHttpClient('http:');
    try {
      await client.request(
        { ...credentials, host },
        { api: 'pms_api', method: 'GET', path: '/room_types' },
      );
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    const logged = logSpy.join('\n');
    expect(logged).not.toContain('sandbox-secret-key');
    expect(logged).not.toContain('Digest username=');
  });

  it('reuses the pooled agent across multiple requests without error', async () => {
    let requestCount = 0;
    const host = await startMockServer((request, response) => {
      requestCount += 1;
      if (!request.headers.authorization) {
        response.writeHead(401, {
          'www-authenticate': `Digest realm="API", qop="auth", algorithm=MD5, nonce="${NONCE}-${requestCount}", opaque="${OPAQUE}"`,
        });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });

    client = new ClockHttpClient('http:');
    const first = await client.request(
      { ...credentials, host },
      { api: 'pms_api', method: 'GET', path: '/room_types' },
    );
    const second = await client.request(
      { ...credentials, host },
      { api: 'pms_api', method: 'GET', path: '/rooms' },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('surfaces a non-JSON error page as raw text rather than throwing', async () => {
    const host = await startMockServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<html><body>Not Found</body></html>');
    });

    client = new ClockHttpClient('http:');
    const result = await client.request(
      { ...credentials, host },
      { api: 'pms_api', method: 'GET', path: '/unknown' },
    );

    expect(result.status).toBe(404);
    expect(result.body).toContain('Not Found');
  });

  it('wraps a network failure in ClockHttpError rather than an unhandled rejection', async () => {
    client = new ClockHttpClient('http:');
    await expect(
      client.request(
        { ...credentials, host: '127.0.0.1:1' },
        { api: 'pms_api', method: 'GET', path: '/room_types', timeoutMs: 500 },
      ),
    ).rejects.toThrow(ClockHttpError);
  });

  it('aborts a request that exceeds the configured timeout', async () => {
    const host = await startMockServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      }, 2000);
    });

    client = new ClockHttpClient('http:');
    await expect(
      client.request(
        { ...credentials, host },
        { api: 'pms_api', method: 'GET', path: '/slow', timeoutMs: 100 },
      ),
    ).rejects.toThrow(ClockHttpError);
  });
});

function startMockServer(
  handler: (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => void,
): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`127.0.0.1:${port}`);
    });
  });
}

function verifyDigestResponse(
  authorizationHeader: string,
  expected: {
    username: string;
    password: string;
    method: string;
    uri: string;
    realm: string;
    nonce: string;
  },
): boolean {
  const nc = /nc=(\w+)/.exec(authorizationHeader)?.[1];
  const cnonce = /cnonce="([^"]+)"/.exec(authorizationHeader)?.[1];
  const response = /response="([^"]+)"/.exec(authorizationHeader)?.[1];
  if (!nc || !cnonce || !response) return false;
  const md5 = (input: string) => createHash('md5').update(input).digest('hex');
  const ha1 = md5(`${expected.username}:${expected.realm}:${expected.password}`);
  const ha2 = md5(`${expected.method}:${expected.uri}`);
  const expectedResponse = md5(`${ha1}:${expected.nonce}:${nc}:${cnonce}:auth:${ha2}`);
  return response === expectedResponse;
}
