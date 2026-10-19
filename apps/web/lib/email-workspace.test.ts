import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailWriter, emailRequest, EmailRequestError } from './email-workspace';
afterEach(() => vi.unstubAllGlobals());
describe('Email writes', () => {
  it('keeps the operation key after a lost response and rotates it when intent changes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const write = createEmailWriter();
    await expect(write('/draft', { version: 1, body: 'First' }, 'PUT')).rejects.toThrow(
      'Lost response',
    );
    await write('/draft', { version: 1, body: 'First' }, 'PUT');
    const key = (index: number) =>
      new Headers(fetcher.mock.calls[index]![1]?.headers).get('Idempotency-Key');
    expect(key(0)).toBe(key(1));
    fetcher.mockResolvedValue(Response.json({ ok: true }));
    await write('/draft', { version: 1, body: 'Changed' }, 'PUT');
    expect(key(2)).not.toBe(key(1));
  });
  it('retains a server request reference on a permission error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: 'Denied' },
            { status: 403, headers: { 'x-request-id': 'email-17' } },
          ),
        ),
    );
    try {
      await emailRequest('/private');
      throw new Error('Expected denial');
    } catch (error) {
      expect(error).toBeInstanceOf(EmailRequestError);
      expect(error).toMatchObject({ status: 403, reference: 'email-17', message: 'Denied' });
    }
  });
});
