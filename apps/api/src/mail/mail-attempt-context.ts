import { AsyncLocalStorage } from 'node:async_hooks';

export type MailAttemptContext = {
  tenantId: string | null;
  propertyId: string | null;
  messageId: string;
  sensitive: boolean;
  idempotencyKeyOverride?: string;
  guestTransactional?: boolean;
  forceDefault?: boolean;
  finalAttempt?: boolean;
  senderTestVersion?: number;
  senderTestActorId?: string;
};
const attempts = new AsyncLocalStorage<MailAttemptContext>();
/** Keep concurrent message capture/transport identity inside its own asynchronous attempt. */
export function withMailAttempt<T>(context: MailAttemptContext, send: () => T): T {
  return attempts.run(context, send);
}
export function currentMailAttempt() {
  return attempts.getStore();
}
