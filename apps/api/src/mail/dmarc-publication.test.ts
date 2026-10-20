import { expect, it, vi } from 'vitest';
import { readDmarcPublication } from './dmarc-publication';

it('joins TXT chunks, preserves the observed value and reports publication without claiming alignment', async () => {
  const lookup = vi.fn(async () => [
    ['v=DMARC1; ', 'p=reject; rua=mailto:reports@example.com'],
    ['unrelated TXT'],
  ]);
  const result = await readDmarcPublication('hotel.example.com', lookup);
  expect(lookup).toHaveBeenCalledWith('_dmarc.hotel.example.com.');
  expect(result.state).toBe('published');
  expect(result.values).toEqual(['v=DMARC1; p=reject; rua=mailto:reports@example.com']);
  expect(result.message).toContain('does not verify message alignment');
  expect(
    (
      await readDmarcPublication('hotel.example.com', async () => [
        ['v=DMARC1; rua=mailto:reports@example.com'],
      ])
    ).state,
  ).toBe('published');
});
it('does not infer a missing parent policy or suggest replacing one', async () => {
  for (const lookup of [
    async () => [],
    async () => [['site-verification=not-a-dmarc-policy']],
    async () => {
      throw Object.assign(Error('Not found'), { code: 'ENODATA' });
    },
  ]) {
    const result = await readDmarcPublication('mail.hotel.example.com', lookup);
    expect(result.state).toBe('absent');
    expect(result.values).toEqual([]);
    expect(result.message).toContain('parent-domain policy may apply');
  }
});
it('flags duplicate records, duplicate policy tags and missing/invalid policy without declaring verified', async () => {
  for (const values of [
    [['v=DMARC1; p=none'], ['v=DMARC1; p=reject']],
    [['v=DMARC1; p=none; p=reject']],
    [['v=DMARC1']],
    [['v=DMARC1; p=anything']],
  ])
    expect((await readDmarcPublication('hotel.example.com', async () => values)).state).toBe(
      'invalid',
    );
});
it('bounds DNS response size and reports unavailable evidence without leaking resolver errors', async () => {
  for (const lookup of [
    async () => Array.from({ length: 51 }, () => ['v=DMARC1; p=none']),
    async () => [['v=DMARC1; p=none; x=' + 'a'.repeat(8192)]],
    async () => {
      throw Error('private resolver details');
    },
  ]) {
    const result = await readDmarcPublication('hotel.example.com', lookup);
    expect(result.state).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('private resolver details');
  }
});
it('expires a stalled lookup and rejects local names before looking anything up', async () => {
  vi.useFakeTimers();
  try {
    const result = readDmarcPublication(
      'hotel.example.com',
      async () => new Promise<string[][]>(() => {}),
    );
    await vi.advanceTimersByTimeAsync(4001);
    expect((await result).state).toBe('unknown');
    const lookup = vi.fn(async () => []);
    await expect(readDmarcPublication('private.local', lookup)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
