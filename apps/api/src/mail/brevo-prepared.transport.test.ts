import { describe, expect, it, vi } from 'vitest';
import { BrevoPreparedTransport, brevoMessageId, brevoSender } from './brevo-prepared.transport';
import { PreparedMailError } from './prepared-mail-transport';

const message = {
  from: '"Demo Hotel" <hotel@example.test>',
  to: ['guest@example.test'],
  cc: ['staff@example.test'],
  bcc: ['owner@example.test'],
  replyTo: 'reservations@example.test',
  subject: 'Booking',
  html: '<p>Hello</p>',
  text: 'Hello',
  messageId: '<message@mustbooking.com>',
};

describe('brevoSender', () => {
  it.each([
    ['"Demo Hotel" <hotel@example.test>', { name: 'Demo Hotel', email: 'hotel@example.test' }],
    ['Demo Hotel <hotel@example.test>', { name: 'Demo Hotel', email: 'hotel@example.test' }],
    ['<hotel@example.test>', { email: 'hotel@example.test' }],
    ['hotel@example.test', { email: 'hotel@example.test' }],
  ])('splits %s into Brevo sender fields', (from, expected) => {
    expect(brevoSender(from)).toEqual(expected);
  });
  it('refuses a sender that is not an address', () => {
    expect(() => brevoSender('Demo Hotel')).toThrow(PreparedMailError);
  });
});

it('matches Brevo webhook ids by dropping the angle brackets of the send answer', () => {
  expect(brevoMessageId('<2026.1@smtp-relay.mailin.fr>')).toBe('2026.1@smtp-relay.mailin.fr');
  expect(brevoMessageId('2026.1@smtp-relay.mailin.fr')).toBe('2026.1@smtp-relay.mailin.fr');
});

it('sends the frozen envelope to the fixed Brevo origin with the hotel key', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ messageId: '<2026.1@smtp-relay.mailin.fr>' }, { status: 201 }),
    );
  expect(
    await new BrevoPreparedTransport('xkeysib-test', request).send(message, 'stable-key'),
  ).toEqual({
    provider: 'brevo',
    providerMessageId: '2026.1@smtp-relay.mailin.fr',
  });
  const [url, options] = request.mock.calls[0]!;
  expect(url).toBe('https://api.brevo.com/v3/smtp/email');
  expect(options?.method).toBe('POST');
  expect(options?.redirect).toBe('error');
  expect(new Headers(options?.headers).get('api-key')).toBe('xkeysib-test');
  expect(JSON.parse(String(options?.body))).toEqual({
    sender: { name: 'Demo Hotel', email: 'hotel@example.test' },
    to: [{ email: 'guest@example.test' }],
    cc: [{ email: 'staff@example.test' }],
    bcc: [{ email: 'owner@example.test' }],
    replyTo: { email: 'reservations@example.test' },
    subject: 'Booking',
    htmlContent: '<p>Hello</p>',
    textContent: 'Hello',
    headers: { 'X-Mailin-custom': 'stable-key' },
  });
});

it.each([400, 401, 402, 403, 429])(
  'treats HTTP %i as a proven rejection, retrying only a rate limit, without leaking the body',
  async (status) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: 'test-secret-provider-error' }, { status }));
    const outcome = await new BrevoPreparedTransport('xkeysib-test', request)
      .send(message, 'key')
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(PreparedMailError);
    expect(outcome).toMatchObject({ acceptance: 'rejected', retryable: status === 429 });
    expect(String(outcome)).not.toContain('test-secret-provider-error');
  },
);

it.each([408, 409, 425, 500, 503])(
  'never re-sends automatically after ambiguous HTTP %i (Brevo has no idempotency)',
  async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(
      new BrevoPreparedTransport('xkeysib-test', request).send(message, 'key'),
    ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
  },
);

it('treats a lost response or an accepted answer without a message id as unknown', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(Error('test-secret-network-detail'))
    .mockResolvedValueOnce(Response.json({ unexpected: true }, { status: 201 }));
  const transport = new BrevoPreparedTransport('xkeysib-test', request);
  await expect(transport.send(message, 'key')).rejects.toMatchObject({ acceptance: 'unknown' });
  await expect(transport.send(message, 'key')).rejects.toMatchObject({ acceptance: 'unknown' });
});

it('rejects header injection and oversized envelopes before contacting Brevo', async () => {
  const request = vi.fn<typeof fetch>();
  const transport = new BrevoPreparedTransport('xkeysib-test', request);
  await expect(
    transport.send({ ...message, subject: 'Hi\r\nBcc:other@example.test' }, 'key'),
  ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false });
  await expect(
    transport.send(
      { ...message, to: Array.from({ length: 100 }, (_, i) => `g${i}@example.test`) },
      'key',
    ),
  ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false });
  expect(request).not.toHaveBeenCalled();
});

describe('check', () => {
  const answers = (senders: unknown, domains: unknown) =>
    vi.fn<typeof fetch>(async (url) => {
      const path = String(url);
      if (path.endsWith('/account')) return Response.json({ email: 'owner@example.test' });
      if (path.endsWith('/senders/domains')) return Response.json(domains);
      return Response.json(senders);
    });

  it('passes when the key works and the From address is an active sender; reports the domain', async () => {
    const request = answers(
      { senders: [{ email: 'Hotel@Example.test', active: true }] },
      { domains: [{ domain_name: 'example.test', authenticated: true }] },
    );
    expect(
      await new BrevoPreparedTransport('xkeysib-test', request).check('hotel@example.test'),
    ).toEqual({ ok: true, domainAuthenticated: true });
    for (const [, options] of request.mock.calls) expect(options?.method).toBe('GET');
  });

  it('fails when the From address is missing or inactive in Brevo', async () => {
    const request = answers(
      { senders: [{ email: 'hotel@example.test', active: false }] },
      { domains: [] },
    );
    expect(
      await new BrevoPreparedTransport('xkeysib-test', request).check('hotel@example.test'),
    ).toEqual({ ok: false, domainAuthenticated: false });
  });

  it('still passes with an unauthenticated domain, reporting it', async () => {
    const request = answers(
      { senders: [{ email: 'hotel@example.test', active: true }] },
      { domains: [{ domain_name: 'example.test', authenticated: false }] },
    );
    expect(
      await new BrevoPreparedTransport('xkeysib-test', request).check('hotel@example.test'),
    ).toEqual({ ok: true, domainAuthenticated: false });
  });

  it('fails without leaking anything when Brevo refuses the key or the IP', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ code: 'unauthorized', message: 'unrecognised IP' }, { status: 401 }),
      );
    expect(
      await new BrevoPreparedTransport('xkeysib-test', request).check('hotel@example.test'),
    ).toEqual({ ok: false, domainAuthenticated: false });
  });
});
