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
  it('resumes the exact original version and export cutoff after a 503 despite refreshed observations', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: 'Recorded but response unavailable' }, { status: 503 }),
      )
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const write = createEmailWriter(),
      first = {
        version: 1,
        through: '2026-10-19T10:00:00Z',
        filters: { topic: 'owner.alert' },
        reason: 'Export failures',
      };
    await expect(write('/export', first)).rejects.toThrow('Recorded');
    await write('/export', { ...first, version: 2, through: '2026-10-19T10:05:00Z' });
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify(first));
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(fetcher.mock.calls[0][1]?.headers).get('Idempotency-Key'),
    );
    await write('/export', { ...first, version: 3, through: '2026-10-19T10:10:00Z' });
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Idempotency-Key')).not.toBe(
      new Headers(fetcher.mock.calls[1][1]?.headers).get('Idempotency-Key'),
    );
  });
  it('does not replay an old approval after an explicit input change or definitive conflict', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Unknown response'))
      .mockResolvedValueOnce(Response.json({ message: 'Version conflict' }, { status: 409 }))
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const write = createEmailWriter();
    await expect(write('/copy', { version: 1, reason: 'Original request' })).rejects.toThrow(
      'Unknown',
    );
    await expect(write('/copy', { version: 2, reason: 'Changed decision' })).rejects.toThrow(
      'Version conflict',
    );
    await write('/copy', { version: 3, reason: 'Changed decision' });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      version: 2,
      reason: 'Changed decision',
    });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      version: 3,
      reason: 'Changed decision',
    });
  });
});
