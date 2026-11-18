import type { PreparedTransportMessage } from './smtp-transport';
import { PreparedMailError, type PreparedMailTransport } from './prepared-mail-transport';

const BREVO_API = 'https://api.brevo.com/v3';
const API_KEY = /^[\x21-\x7e]{1,1024}$/;

/** Splits a frozen `"Name" <address>` sender back into the fields Brevo expects. */
export function brevoSender(from: string): { name?: string; email: string } {
  const match = /^(?:"([^"]*)"|([^"<>]*?))\s*<([^<>\s]+@[^<>\s]+)>$/.exec(from.trim());
  if (match) {
    const name = (match[1] ?? match[2] ?? '').trim();
    return name ? { name, email: match[3]! } : { email: match[3]! };
  }
  const bare = /^<?([^<>\s]+@[^<>\s]+)>?$/.exec(from.trim());
  if (!bare) throw new PreparedMailError('rejected', false);
  return { email: bare[1]! };
}

/** Brevo's send answer wraps the id in angle brackets; its webhooks send it without them. */
export function brevoMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, '');
}

async function readSmallJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  let text = '',
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 65_536) {
        await reader.cancel();
        throw new Error();
      }
      text += new TextDecoder().decode(part.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export type BrevoConnectionResult = {
  /** The API key works and the From address is an active sender in that Brevo account. */
  ok: boolean;
  /** Brevo authenticates the From address's domain; otherwise Brevo rewrites the From. */
  domainAuthenticated: boolean;
};

/**
 * Fixed-origin Brevo adapter. Brevo documents no idempotency for transactional email, so any
 * answer that does not prove rejection is "unknown": the journal then never re-sends it
 * automatically, exactly as for SMTP.
 */
export class BrevoPreparedTransport implements PreparedMailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(message: PreparedTransportMessage, idempotencyKey: string) {
    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
    if (
      !API_KEY.test(this.apiKey) ||
      !/^[\x21-\x7e]{1,256}$/.test(idempotencyKey) ||
      !message.to.length ||
      recipients.length > 99 ||
      [message.from, message.subject, message.replyTo ?? '', ...recipients].some((value) =>
        /[\r\n\0]/.test(value),
      )
    )
      throw new PreparedMailError('rejected', false);
    const list = (addresses: string[]) => addresses.map((email) => ({ email }));
    let response: Response;
    try {
      response = await this.request(`${BREVO_API}/smtp/email`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'api-key': this.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: brevoSender(message.from),
          to: list(message.to),
          ...(message.cc?.length ? { cc: list(message.cc) } : {}),
          ...(message.bcc?.length ? { bcc: list(message.bcc) } : {}),
          ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          // Lets a Brevo delivery event be matched to this MUST message; not a duplicate guard.
          headers: { 'X-Mailin-custom': idempotencyKey },
        }),
      });
    } catch {
      throw new PreparedMailError('unknown', false);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status >= 500 || [408, 409, 425].includes(response.status))
        throw new PreparedMailError('unknown', false);
      // 400 (bad request, no credits), 401/403 (key or IP refused): Brevo did not accept it.
      throw new PreparedMailError('rejected', response.status === 429);
    }
    try {
      const body = await readSmallJson(response);
      if (
        !body ||
        typeof body !== 'object' ||
        !('messageId' in body) ||
        typeof body.messageId !== 'string'
      )
        throw new Error();
      const id = brevoMessageId(body.messageId);
      if (!/^[\x21-\x7e]{1,200}$/.test(id)) throw new Error();
      return { provider: 'brevo' as const, providerMessageId: id };
    } catch {
      throw new PreparedMailError('unknown', false);
    }
  }

  /** Read-only check: the key works, the From address is an active Brevo sender, and whether its domain is authenticated. Sends nothing. */
  async check(fromAddress: string): Promise<BrevoConnectionResult> {
    if (!API_KEY.test(this.apiKey)) return { ok: false, domainAuthenticated: false };
    const get = async (path: string): Promise<unknown> => {
      const response = await this.request(`${BREVO_API}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'api-key': this.apiKey, accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error();
      }
      return readSmallJson(response);
    };
    try {
      await get('/account');
      const senders = (await get('/senders')) as { senders?: unknown };
      const address = fromAddress.toLowerCase();
      const active =
        Array.isArray(senders.senders) &&
        senders.senders.some(
          (s) =>
            !!s &&
            typeof s === 'object' &&
            (s as { email?: unknown }).email?.toString().toLowerCase() === address &&
            (s as { active?: unknown }).active === true,
        );
      let domainAuthenticated = false;
      try {
        const domains = (await get('/senders/domains')) as { domains?: unknown };
        const domain = address.split('@')[1];
        domainAuthenticated =
          Array.isArray(domains.domains) &&
          domains.domains.some(
            (d) =>
              !!d &&
              typeof d === 'object' &&
              (d as { domain_name?: unknown }).domain_name?.toString().toLowerCase() === domain &&
              (d as { authenticated?: unknown }).authenticated === true,
          );
      } catch {
        domainAuthenticated = false;
      }
      return { ok: active, domainAuthenticated };
    } catch {
      return { ok: false, domainAuthenticated: false };
    }
  }
}
