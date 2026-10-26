import { expect, it, vi } from 'vitest';
import { ResendSendingDomainProvider } from './resend-domain.provider';
import { SendingDomainProviderError } from './sending-domain-provider';

const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const apiKey = 're_test_only_domain_key';
const domain = (status = 'pending') => ({
  id: id(),
  name: 'example.com',
  status,
  capabilities: { sending: 'enabled', receiving: 'disabled' },
  records: [
    {
      record: 'SPF',
      type: 'MX',
      name: 'send',
      value: 'feedback-smtp.eu-west-1.amazonses.com',
      priority: 10,
      ttl: 'Auto',
      status: 'pending',
    },
    {
      record: 'SPF',
      type: 'TXT',
      name: 'send',
      value: '"v=spf1 include:amazonses.com ~all"',
      ttl: 'Auto',
      status: 'pending',
    },
    {
      record: 'DKIM',
      type: 'TXT',
      name: 'resend._domainkey',
      value: 'p=TEST_PUBLIC_DNS_KEY',
      ttl: 300,
      status: 'verified',
    },
  ],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
it('finds only an exact domain through documented cursor pagination, using a fixed origin and bounded request', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ data: [{ id: id(2), name: 'not-example.com' }], has_more: true }))
    .mockResolvedValueOnce(json({ data: [{ id: id(), name: 'EXAMPLE.COM' }], has_more: false }));
  const provider = new ResendSendingDomainProvider(apiKey, fetcher);
  await expect(provider.findDomain('Example.com.')).resolves.toEqual({
    id: id(),
    name: 'example.com',
  });
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    'https://api.resend.com/domains?limit=100',
    `https://api.resend.com/domains?limit=100&after=${id(2)}`,
  ]);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});
it('reports absence only after the complete list and rejects empty/repeated/capped cursors', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [], has_more: false }));
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).findDomain('example.com'),
  ).resolves.toBeNull();
  for (const payload of [
    { data: [], has_more: true },
    { data: [], has_more: 'yes' },
    { data: [{ id: 'not-an-id', name: 'other.com' }], has_more: false },
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(payload));
    await expect(
      new ResendSendingDomainProvider(apiKey, fetch).findDomain('example.com'),
    ).rejects.toThrow(SendingDomainProviderError);
  }
  const repeated = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      json({ data: [{ id: id(2), name: 'other.com' }], has_more: true }),
    );
  await expect(
    new ResendSendingDomainProvider(apiKey, repeated).findDomain('example.com'),
  ).rejects.toThrow(SendingDomainProviderError);
  expect(repeated).toHaveBeenCalledTimes(2);
  let page = 0;
  const capped = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      json({ data: [{ id: id(++page), name: 'other.com' }], has_more: true }),
    );
  await expect(
    new ResendSendingDomainProvider(apiKey, capped).findDomain('example.com'),
  ).rejects.toThrow(SendingDomainProviderError);
  expect(capped).toHaveBeenCalledTimes(20);
});
it('preserves exact provider DNS evidence without inventing verified SPF, TTL or FQDN', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(domain()));
  const result = await new ResendSendingDomainProvider(apiKey, fetcher).getDomain(
    id(),
    'example.com',
  );
  expect(result).toEqual({
    provider: 'resend',
    id: id(),
    name: 'example.com',
    status: 'pending',
    verified: false,
    sendingEnabled: true,
    records: domain().records,
  });
  expect(JSON.stringify(result)).not.toContain(apiKey);
});
it('requires the exact returned ID/domain and refuses invalid or oversized DNS evidence', async () => {
  for (const patch of [
    { id: id(2) },
    { name: 'another.com' },
    { records: [], capabilities: {} },
    { records: Array(101).fill(domain().records[0]) },
    { records: [{ ...domain().records[0], priority: -1 }] },
    { records: [{ ...domain().records[0], value: 'x'.repeat(8193) }] },
  ]) {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ ...domain(), ...patch }));
    await expect(
      new ResendSendingDomainProvider(apiKey, fetcher).getDomain(id(), 'example.com'),
    ).rejects.toThrow(SendingDomainProviderError);
    expect(fetcher).toHaveBeenCalledOnce();
  }
});
it('creates a new EU sending-only domain once with no open/click tracking', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(domain('not_started')));
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).createDomain('Example.com'),
  ).resolves.toMatchObject({ verified: false, status: 'not_started' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/domains');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    name: 'example.com',
    region: 'eu-west-1',
    capabilities: { sending: 'enabled', receiving: 'disabled' },
    open_tracking: false,
    click_tracking: false,
  });
});
it('never retries an uncertain create and redacts raw fetch errors, invalid success bodies and provider failures', async () => {
  for (const fetcher of [
    vi.fn<typeof fetch>().mockRejectedValue(new Error(apiKey)),
    vi.fn<typeof fetch>().mockResolvedValue(json({ private: apiKey })),
    vi.fn<typeof fetch>().mockResolvedValue(json({ private: apiKey }, 503)),
    vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON')),
  ]) {
    const promise = new ResendSendingDomainProvider(apiKey, fetcher).createDomain('example.com');
    await expect(promise).rejects.toMatchObject({ uncertain: true });
    await expect(promise).rejects.not.toThrow(apiKey);
    expect(fetcher).toHaveBeenCalledOnce();
  }
  const rejected = vi.fn<typeof fetch>().mockResolvedValue(json({ private: apiKey }, 403));
  await expect(
    new ResendSendingDomainProvider(apiKey, rejected).createDomain('example.com'),
  ).rejects.toMatchObject({ uncertain: false, retryable: false, status: 403 });
});
it('reads an already verified domain without resetting shared verification state', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(domain('verified')));
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).recheckDomain(id(), 'example.com'),
  ).resolves.toMatchObject({ verified: true, sendingEnabled: true });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
});
it('treats a verify POST as asynchronous and uses the following actual observation', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(domain()))
    .mockResolvedValueOnce(json({ id: id(), object: 'domain' }))
    .mockResolvedValueOnce(json(domain()));
  const result = await new ResendSendingDomainProvider(apiKey, fetcher).recheckDomain(
    id(),
    'example.com',
  );
  expect(result.verified).toBe(false);
  expect(fetcher.mock.calls.map(([url, options]) => [String(url), options?.method])).toEqual([
    ['https://api.resend.com/domains/' + id(), 'GET'],
    ['https://api.resend.com/domains/' + id() + '/verify', 'POST'],
    ['https://api.resend.com/domains/' + id(), 'GET'],
  ]);
});
it('rejects verify receipt mismatch and validates identity before a provider mutation', async () => {
  const mismatch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(domain()))
    .mockResolvedValueOnce(json({ id: id(2) }));
  await expect(
    new ResendSendingDomainProvider(apiKey, mismatch).recheckDomain(id(), 'example.com'),
  ).rejects.toMatchObject({ uncertain: true });
  const foreign = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...domain(), name: 'foreign.com' }));
  await expect(
    new ResendSendingDomainProvider(apiKey, foreign).recheckDomain(id(), 'example.com'),
  ).rejects.toThrow(SendingDomainProviderError);
  expect(foreign).toHaveBeenCalledOnce();
});
it('bounds response bytes, refusing an oversized successful create as an unknown outcome', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).createDomain('example.com'),
  ).rejects.toMatchObject({ uncertain: true });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('stops an aborted request without an automatic create retry', async () => {
  const controller = new AbortController(),
    timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(apiKey)), { once: true });
      }),
  );
  try {
    const result = expect(
      new ResendSendingDomainProvider(apiKey, fetcher).createDomain('example.com'),
    ).rejects.toMatchObject({ uncertain: true });
    controller.abort();
    await result;
    expect(timeout).toHaveBeenCalledWith(10000);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    timeout.mockRestore();
  }
});
it('rejects credential header injection, invalid paths and unsafe hostnames before making any provider request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    new ResendSendingDomainProvider('bad\r\nkey', fetcher).findDomain('example.com'),
  ).rejects.toThrow(SendingDomainProviderError);
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).getDomain('../keys', 'example.com'),
  ).rejects.toThrow(SendingDomainProviderError);
  await expect(
    new ResendSendingDomainProvider(apiKey, fetcher).createDomain('http://127.0.0.1'),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
