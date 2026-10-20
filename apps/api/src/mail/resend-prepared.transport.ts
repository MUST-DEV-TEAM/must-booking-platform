import type { PreparedTransportMessage } from './smtp-transport';
import { PreparedMailError, type PreparedMailTransport } from './prepared-mail-transport';

/** Fixed-origin Resend adapter; secret/error bodies and redirects never leave this boundary. */
export class ResendPreparedTransport implements PreparedMailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async send(message: PreparedTransportMessage, idempotencyKey: string) {
    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
    if (
      !/^[\x21-\x7e]{1,1024}$/.test(this.apiKey) ||
      !/^[\x21-\x7e]{1,256}$/.test(idempotencyKey) ||
      !message.to.length ||
      recipients.length > 100 ||
      [message.from, message.subject, message.replyTo ?? '', ...recipients].some((value) =>
        /[\r\n\0]/.test(value),
      )
    )
      throw new PreparedMailError('rejected', false);
    let response: Response;
    try {
      response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.cc?.length ? { cc: message.cc } : {}),
          ...(message.bcc?.length ? { bcc: message.bcc } : {}),
        }),
      });
    } catch {
      throw new PreparedMailError('unknown', false);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      // A server error, timeout response or idempotency conflict cannot prove non-acceptance.
      if (response.status >= 500 || [408, 409, 425].includes(response.status))
        throw new PreparedMailError('unknown', false);
      throw new PreparedMailError('rejected', response.status === 429);
    }
    try {
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      let text = '',
        bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16_384) {
            await reader.cancel();
            throw new Error();
          }
          text += new TextDecoder().decode(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const body: unknown = JSON.parse(text);
      if (
        !body ||
        typeof body !== 'object' ||
        !('id' in body) ||
        typeof body.id !== 'string' ||
        !/^[\w-]{1,200}$/.test(body.id)
      )
        throw new Error();
      return { provider: 'resend' as const, providerMessageId: body.id };
    } catch {
      throw new PreparedMailError('unknown', false);
    }
  }
}
