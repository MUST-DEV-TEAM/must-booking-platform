import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');

export class SmtpNetworkPolicyError extends Error {
  constructor() {
    super('Use a public SMTP hostname whose DNS records all resolve to public addresses.');
    this.name = 'SmtpNetworkPolicyError';
  }
}
export type SmtpLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Fail closed on special-use addresses, including mapped IPv4 and IPv6 transition networks. */
export function isPublicSmtpAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

/** DNS names only; no literal IPs, URL syntax, single labels or reserved local suffixes. */
export function smtpHostname(input: string): string {
  const hostname = input.trim().toLowerCase().replace(/\.$/, '');
  if (
    hostname.length > 253 ||
    isIP(hostname) ||
    !hostname.includes('.') ||
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/[a-z]/.test(hostname.split('.').at(-1) ?? '') ||
    /(?:^|\.)(?:localhost|local|internal|lan|test|invalid|example|onion)$/.test(hostname) ||
    hostname.endsWith('.home.arpa')
  )
    throw new SmtpNetworkPolicyError();
  return hostname;
}

/** Re-resolve for every connection, reject mixed public/private answers, then pin a checked IP. */
export async function resolveSmtpEndpoint(
  input: string,
  resolve: SmtpLookup = (hostname) => lookup(hostname, { all: true, verbatim: true }),
) {
  const hostname = smtpHostname(input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmtpNetworkPolicyError()), 5000);
        timer.unref?.();
      }),
    ]);
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some(
        (record) => record.family !== isIP(record.address) || !isPublicSmtpAddress(record.address),
      )
    )
      throw new SmtpNetworkPolicyError();
    return { hostname, address: addresses[0].address };
  } catch {
    throw new SmtpNetworkPolicyError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
