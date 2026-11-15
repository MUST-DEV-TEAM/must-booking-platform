import { describe, expect, it } from 'vitest';

import { failureReason } from './clock-failure-reason';

describe('the reason saved on a failed webhook event', () => {
  it('keeps the error name and its code', () => {
    const error = Object.assign(new Error('Unable to start a transaction in the given time.'), {
      code: 'P2028',
    });
    expect(failureReason(error)).toBe(
      'Error, code P2028: Unable to start a transaction in the given time.',
    );
  });

  it('masks an email address and a long number', () => {
    const reason = failureReason(new Error('Guest anna@example.com paid 1234567 for room 12'));
    expect(reason).not.toContain('anna@example.com');
    expect(reason).not.toContain('1234567');
    expect(reason).toContain('room 12');
  });

  it('drops the query string of a URL', () => {
    const reason = failureReason(
      new Error('GET https://clock.example/api/x?token=abc&id=9 failed'),
    );
    expect(reason).not.toContain('token=abc');
  });

  it('keeps the first line only', () => {
    expect(failureReason(new Error('first line\nsecond line holds a row'))).toBe(
      'Error: first line',
    );
  });

  it('cuts at 300 characters', () => {
    expect(failureReason(new Error('x'.repeat(1000))).length).toBe(300);
  });

  it('handles a value that is not an error', () => {
    expect(failureReason('boom')).toBe('unknown error');
  });
});
