import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInboxWriter,
  validateInboxPage,
  InboxError,
  inboxRequest,
  safeNotificationHref,
} from './notification-inbox';
afterEach(() => vi.unstubAllGlobals());
describe('notification request contract', () => {
  it('retains operation keys on unchanged lost-response retries and changes keys on a new intent', async () => {
    const calls: RequestInit[] = [];
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        if (fail) {
          fail = false;
          throw new Error('Lost response');
        }
        return Response.json({ updated: 1, version: 1 });
      }),
    );
    const write = createInboxWriter();
    await expect(write('/inbox', { version: 0 })).rejects.toThrow('Lost response');
    await write('/inbox', { version: 0 });
    await write('/inbox', { version: 1 });
    expect(calls[0].headers).toEqual(calls[1].headers);
    expect(calls[1].headers).not.toEqual(calls[2].headers);
  });
  it('carries error references without accepting error payloads as data', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"message":"Denied"}', { status: 403, headers: { 'x-request-id': 'ref-1' } }),
    );
    await expect(inboxRequest('/inbox')).rejects.toMatchObject({
      status: 403,
      reference: 'ref-1',
      message: 'Denied',
    });
    expect(new InboxError('x', 500, null)).toBeInstanceOf(Error);
  });
  it('allows only current-property staff/reservation destinations', () => {
    expect(safeNotificationHref('/dashboard/t?propertyId=p&section=staff', 't', 'p')).toBeTruthy();
    for (const href of [
      'https://evil.invalid',
      '//evil.invalid',
      '/dashboard/other?propertyId=p&section=staff',
      '/dashboard/t?propertyId=other&section=staff',
      '/dashboard/t?propertyId=p&section=emails',
    ])
      expect(safeNotificationHref(href, 't', 'p')).toBeNull();
  });
});

it('rejects malformed or partial inbox responses instead of inventing zero counts', () => {
  for (const payload of [null, [], { items: [] }, { items: [], version: 0 }])
    expect(() => validateInboxPage(payload)).toThrow('Notification data is incomplete');
});
