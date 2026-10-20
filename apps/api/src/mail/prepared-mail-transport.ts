import type { PreparedTransportMessage } from './smtp-transport';
import { MailDeliveryError } from './mail-delivery-error';

export type PreparedMailReceipt = {
  provider: 'resend' | 'smtp';
  providerMessageId: string;
  usedFallback?: boolean;
};
/** Unknown acceptance must never cross an automatic transport/account boundary. */
export class PreparedMailError extends MailDeliveryError {
  constructor(
    readonly acceptance: 'rejected' | 'unknown',
    retryable: boolean,
  ) {
    super(
      acceptance === 'unknown'
        ? 'Delivery acceptance is unknown. Automatic retry and fallback are stopped to avoid duplicate email.'
        : 'The sending service rejected the email. Check the hotel sending configuration.',
      retryable,
    );
  }
}
/** Provider-neutral boundary for an already frozen message and its stable attempt key. */
export interface PreparedMailTransport {
  send(message: PreparedTransportMessage, idempotencyKey: string): Promise<PreparedMailReceipt>;
}
