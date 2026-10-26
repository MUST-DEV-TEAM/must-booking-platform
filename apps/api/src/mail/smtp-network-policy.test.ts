import { describe, expect, it, vi } from 'vitest';
import {
  isPublicSmtpAddress,
  resolveSmtpEndpoint,
  smtpHostname,
  SmtpNetworkPolicyError,
} from './smtp-network-policy';

describe('SMTP network boundary', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.9',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:0808:0808',
    '64:ff9b::808:808',
    '100::1',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:db8::1',
    '2002:808:808::1',
    '3ffe::1',
    '3fff::1',
    '2001:4860:4860::8888%eth0',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    'not an address',
  ])('rejects special-use %s', (address) => expect(isPublicSmtpAddress(address)).toBe(false));
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '2a00:1450:4001::1',
  ])('accepts globally routable %s', (address) => expect(isPublicSmtpAddress(address)).toBe(true));
  it.each([
    'localhost',
    'smtp.localhost',
    'mail.internal',
    'mail.local',
    'mail.lan',
    'mail.home.arpa',
    'mail.test',
    'mail.onion',
    '127.0.0.1',
    '[::1]',
    '2130706433',
    '0177.0.0.1',
    '0x7f.0.0.1',
    'https://smtp.gmail.com',
    'smtp.gmail.com:587',
    'user@smtp.gmail.com',
    'smtp..gmail.com',
    'smtp.gmail.com\n.evil',
    '-smtp.gmail.com',
  ])('rejects unsafe hostname %s', (hostname) =>
    expect(() => smtpHostname(hostname)).toThrow(SmtpNetworkPolicyError),
  );
  it('canonicalizes a DNS name and checks every answer before pinning one', async () => {
    const dns = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '::1', family: 6 },
    ]);
    await expect(resolveSmtpEndpoint(' SMTP.GMAIL.COM. ', dns)).rejects.toThrow(
      SmtpNetworkPolicyError,
    );
    dns.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    await expect(resolveSmtpEndpoint(' SMTP.GMAIL.COM. ', dns)).resolves.toEqual({
      hostname: 'smtp.gmail.com',
      address: '8.8.8.8',
    });
    expect(dns).toHaveBeenLastCalledWith('smtp.gmail.com');
    dns.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(resolveSmtpEndpoint('smtp.gmail.com', dns)).rejects.toThrow(
      SmtpNetworkPolicyError,
    );
    expect(dns).toHaveBeenCalledTimes(3);
  });
  it('rejects empty, malformed and excessive DNS sets and conceals resolver errors', async () => {
    for (const records of [
      [],
      [{ address: '8.8.8.8', family: 6 }],
      Array.from({ length: 65 }, () => ({ address: '8.8.8.8', family: 4 })),
    ])
      await expect(resolveSmtpEndpoint('smtp.gmail.com', async () => records)).rejects.toThrow(
        SmtpNetworkPolicyError,
      );
    await expect(
      resolveSmtpEndpoint('smtp.gmail.com', async () => {
        throw new Error('private resolver detail');
      }),
    ).rejects.not.toThrow('private resolver detail');
  });
  it('bounds stalled DNS and clears its timeout', async () => {
    vi.useFakeTimers();
    try {
      const result = expect(
        resolveSmtpEndpoint('smtp.gmail.com', () => new Promise(() => {})),
      ).rejects.toThrow(SmtpNetworkPolicyError);
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
