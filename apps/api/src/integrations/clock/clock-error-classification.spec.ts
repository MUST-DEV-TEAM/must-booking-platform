import { describe, expect, it } from 'vitest';

import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
  classifyConfigurationError,
  classifySchemaMismatch,
} from './clock-error-classification';

describe('classifyClockHttpResponse', () => {
  it('classifies 401 as authentication, not retryable', () => {
    const result = classifyClockHttpResponse(401, 'HTTP Digest: Access denied.');
    expect(result).toMatchObject({ category: 'authentication', retryable: false });
  });

  it('classifies 403 as authorization using the real sandbox error shape', () => {
    const result = classifyClockHttpResponse(403, {
      error: "The User doesn't have pms_api_accounts_show right",
    });
    expect(result).toMatchObject({
      category: 'authorization',
      retryable: false,
      message: "The User doesn't have pms_api_accounts_show right",
    });
  });

  it('classifies 400 as validation using the real sandbox contract-error shape', () => {
    const result = classifyClockHttpResponse(400, {
      error: 'RestApi::Interactions::RateAvailability::Contract\nfrom.filled?',
    });
    expect(result.category).toBe('validation');
    expect(result.retryable).toBe(false);
  });

  it('classifies 404 as not_found', () => {
    expect(classifyClockHttpResponse(404, null).category).toBe('not_found');
  });

  it('classifies 409 as conflict', () => {
    expect(classifyClockHttpResponse(409, null).category).toBe('conflict');
  });

  it('classifies 429 as rate_limited and retryable', () => {
    const result = classifyClockHttpResponse(429, null);
    expect(result).toMatchObject({ category: 'rate_limited', retryable: true });
  });

  it.each([502, 503, 504])('classifies %i as provider_unavailable and retryable', (status) => {
    const result = classifyClockHttpResponse(status, null);
    expect(result).toMatchObject({ category: 'provider_unavailable', retryable: true });
  });

  it('classifies an unmapped 5xx as permanent, not retryable', () => {
    const result = classifyClockHttpResponse(500, null);
    expect(result).toMatchObject({ category: 'permanent', retryable: false });
  });

  it('classifies an unmapped status as unknown_result', () => {
    const result = classifyClockHttpResponse(418, null);
    expect(result.category).toBe('unknown_result');
  });

  it('extracts a plain-text HTML body as the message, truncated', () => {
    const result = classifyClockHttpResponse(404, '<html>not found</html>'.repeat(50));
    expect(result.message.length).toBeLessThanOrEqual(500);
  });
});

describe('classifyClockClientFailure', () => {
  it('marks timeout as retryable', () => {
    expect(classifyClockClientFailure('timeout', 'timed out').retryable).toBe(true);
  });

  it('marks network as retryable', () => {
    expect(classifyClockClientFailure('network', 'ECONNREFUSED').retryable).toBe(true);
  });
});

describe('classifySchemaMismatch / classifyConfigurationError', () => {
  it('are never retryable', () => {
    expect(classifySchemaMismatch('unexpected shape').retryable).toBe(false);
    expect(classifyConfigurationError('missing apiKey').retryable).toBe(false);
  });
});
