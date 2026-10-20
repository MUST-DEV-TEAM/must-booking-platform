import { expect, it, vi } from 'vitest';
import { ResendPreparedTransport } from './resend-prepared.transport';
import { PreparedMailError } from './prepared-mail-transport';
const message = {
  from: 'Hotel <hotel@example.test>',
  to: ['guest@example.test'],
  cc: ['staff@example.test'],
  bcc: ['owner@example.test'],
  subject: 'Booking',
  html: '<p>Hello</p>',
  text: 'Hello',
  messageId: '<message@mustbooking.com>',
};
it('sends the exact frozen envelope and stable key to the fixed provider origin', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'receipt-1' }));
  expect(
    await new ResendPreparedTransport('test-key', request).send(message, 'stable-key'),
  ).toEqual({ provider: 'resend', providerMessageId: 'receipt-1' });
  const [url, options] = request.mock.calls[0]!;
  expect(url).toBe('https://api.resend.com/emails');
  expect(options?.redirect).toBe('error');
  expect(new Headers(options?.headers).get('idempotency-key')).toBe('stable-key');
  expect(JSON.parse(String(options?.body))).toEqual({
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
});
it.each([400, 401, 403, 422, 429])(
  'sanitizes HTTP %i and retries only proven rate-limit rejection',
  async (status) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: 'test-secret-provider-error' }, { status }));
    const outcome = await new ResendPreparedTransport('test-key', request)
      .send(message, 'key')
      .catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(PreparedMailError);
    expect(outcome).toMatchObject({ acceptance: 'rejected', retryable: status === 429 });
    expect(String(outcome)).not.toContain('test-secret-provider-error');
  },
);
it.each([408, 409, 425, 500, 503])(
  'never falls back automatically after ambiguous HTTP %i',
  async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(
      new ResendPreparedTransport('test-key', request).send(message, 'key'),
    ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
  },
);
it('treats a lost response or malformed accepted receipt as unknown', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(Error('test-secret-network-detail'))
    .mockResolvedValueOnce(Response.json({ unexpected: true }));
  const transport = new ResendPreparedTransport('test-key', request);
  await expect(transport.send(message, 'key')).rejects.toMatchObject({
    acceptance: 'unknown',
    retryable: false,
  });
  await expect(transport.send(message, 'key')).rejects.toMatchObject({
    acceptance: 'unknown',
    retryable: false,
  });
});
it('bounds accepted response bytes and does not expose the response', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(17000)));
  await expect(
    new ResendPreparedTransport('test-key', request).send(message, 'key'),
  ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
});
it('rejects header injection before contacting the provider', async () => {
  const request = vi.fn<typeof fetch>();
  await expect(
    new ResendPreparedTransport('test-key', request).send(
      { ...message, subject: 'Hi\r\nBcc:other@example.test' },
      'key',
    ),
  ).rejects.toMatchObject({ acceptance: 'rejected', retryable: false });
  expect(request).not.toHaveBeenCalled();
});
