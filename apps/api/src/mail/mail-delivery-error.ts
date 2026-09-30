/**
 * A failed transport call, classified so the delivery queue knows whether a
 * retry can help. `retryable` is true for network errors, timeouts, 429 and 5xx;
 * other 4xx responses (bad sender, rejected address, invalid payload) will not
 * succeed on retry.
 */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
