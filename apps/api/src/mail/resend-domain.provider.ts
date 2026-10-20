import { smtpHostname } from './smtp-network-policy';
import {
  SendingDomainProviderError,
  type SendingDomainEvidence,
  type SendingDomainProvider,
  type SendingDomainRecord,
} from './sending-domain-provider';

const ORIGIN = 'https://api.resend.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function domainName(input: string): string {
  try {
    return smtpHostname(input);
  } catch {
    throw new SendingDomainProviderError(false, false);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SendingDomainProviderError(false, false);
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 8192): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0'))
    throw new SendingDomainProviderError(false, false);
  return value;
}
function identity(value: unknown) {
  const row = object(value),
    id = text(row.id, 36);
  if (!UUID.test(id)) throw new SendingDomainProviderError(false, false);
  return { id, name: domainName(text(row.name, 253)) };
}
function evidence(value: unknown, expectedName: string): SendingDomainEvidence {
  const row = object(value),
    domain = identity(row);
  if (
    domain.name !== domainName(expectedName) ||
    !Array.isArray(row.records) ||
    row.records.length > 100
  )
    throw new SendingDomainProviderError(false, false);
  const capabilities = object(row.capabilities);
  if (
    typeof capabilities.sending !== 'string' ||
    !['enabled', 'disabled'].includes(capabilities.sending)
  )
    throw new SendingDomainProviderError(false, false);
  const records: SendingDomainRecord[] = row.records.map((value) => {
    const r = object(value),
      ttl = r.ttl;
    if (
      (typeof ttl !== 'string' || ttl.length > 64) &&
      (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 0)
    )
      throw new SendingDomainProviderError(false, false);
    if (
      r.priority !== undefined &&
      (typeof r.priority !== 'number' ||
        !Number.isSafeInteger(r.priority) ||
        r.priority < 0 ||
        r.priority > 65535)
    )
      throw new SendingDomainProviderError(false, false);
    return {
      record: text(r.record, 64),
      name: text(r.name, 512),
      type: text(r.type, 32),
      value: text(r.value),
      status: text(r.status, 64),
      ttl: ttl as string | number,
      ...(r.priority !== undefined ? { priority: r.priority as number } : {}),
    };
  });
  const status = text(row.status, 64);
  return {
    provider: 'resend',
    ...domain,
    status,
    verified: status === 'verified',
    sendingEnabled: capabilities.sending === 'enabled',
    records,
  };
}

/** Resend domain calls only; no credentials, raw provider bodies or caller-controlled origins escape. */
export class ResendSendingDomainProvider implements SendingDomainProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object,
  ): Promise<unknown> {
    const mutating = method === 'POST';
    if (!/^[\x21-\x7e]{1,1024}$/.test(this.apiKey))
      throw new SendingDomainProviderError(false, false);
    try {
      const response = await this.fetcher(ORIGIN + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'must-booking-platform/0.0.0',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new SendingDomainProviderError(
          mutating && (response.status >= 500 || response.status === 408),
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }
      if (!response.body) throw new SendingDomainProviderError(mutating, false);
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1_000_000) {
            await reader.cancel();
            throw new SendingDomainProviderError(mutating, false);
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof SendingDomainProviderError) throw error;
      throw new SendingDomainProviderError(mutating, true);
    }
  }
  async findDomain(name: string) {
    const expected = domainName(name),
      seen = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
      const result = object(await this.request('/domains?' + query));
      if (
        !Array.isArray(result.data) ||
        result.data.length > 100 ||
        typeof result.has_more !== 'boolean'
      )
        throw new SendingDomainProviderError(false, false);
      const rows = result.data.map(identity),
        match = rows.filter((row) => row.name === expected);
      if (match.length > 1) throw new SendingDomainProviderError(false, false);
      if (match[0]) return match[0];
      if (!result.has_more) return null;
      after = rows.at(-1)?.id;
      if (!after || seen.has(after)) throw new SendingDomainProviderError(false, false);
      seen.add(after);
    }
    throw new SendingDomainProviderError(false, false);
  }
  async getDomain(id: string, expectedName: string) {
    if (!UUID.test(id)) throw new SendingDomainProviderError(false, false);
    const result = evidence(await this.request('/domains/' + id), expectedName);
    if (result.id.toLowerCase() !== id.toLowerCase())
      throw new SendingDomainProviderError(false, false);
    return result;
  }
  async createDomain(name: string) {
    const expected = domainName(name);
    const result = await this.request('/domains', 'POST', {
      name: expected,
      region: 'eu-west-1',
      capabilities: { sending: 'enabled', receiving: 'disabled' },
      open_tracking: false,
      click_tracking: false,
    });
    // An invalid success response can still mean the domain was created. Never blind retry.
    try {
      return evidence(result, expected);
    } catch {
      throw new SendingDomainProviderError(true, false);
    }
  }
  async recheckDomain(id: string, expectedName: string) {
    const current = await this.getDomain(id, expectedName);
    if (current.verified && current.sendingEnabled) return current;
    const response = object(await this.request('/domains/' + id + '/verify', 'POST'));
    if (response.id !== current.id) throw new SendingDomainProviderError(true, false);
    return this.getDomain(id, expectedName);
  }
}
