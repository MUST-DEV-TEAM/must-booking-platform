import { createHash } from 'node:crypto';

import type { MailProvider } from '@must/domain-contracts';

type CommandOf<K extends keyof MailProvider> = Parameters<MailProvider[K]>[0];

/** Emails that flow through the durable delivery queue and the email log. */
export interface QueuedMailCommands {
  paymentConfirmation: CommandOf<'sendPaymentConfirmationEmail'>;
  newBookingStaff: CommandOf<'sendNewBookingStaffNotification'>;
  refundConfirmation: CommandOf<'sendRefundConfirmationEmail'>;
  bookingCancelled: CommandOf<'sendBookingCancelledEmail'>;
  bookingCancelledStaff: CommandOf<'sendBookingCancelledStaffNotification'>;
  verification: CommandOf<'sendVerificationEmail'>;
  welcome: CommandOf<'sendWelcomeEmail'>;
  passwordReset: CommandOf<'sendPasswordResetEmail'>;
  staffInvitation: CommandOf<'sendStaffInvitationEmail'>;
}
export type QueuedMailKind = keyof QueuedMailCommands;

/** Every queued command's fields at once; each switch case below reads only
 * the fields its own kind carries. */
type AnyQueuedMailCommand = QueuedMailCommands[QueuedMailKind] extends infer U
  ? (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void
    ? I
    : never
  : never;

export interface MailDescriptor {
  eventType: string;
  recipient: string;
  subject: string;
  idempotencyKey: string;
  bookingId: string | null;
  /** The message carries a secret link (verify / reset / invite): keep it out of long-lived storage. */
  sensitive: boolean;
}

/** The `token` query parameter of a link, or a placeholder when the link has none. */
export function tokenFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('token') ?? 'missing-token';
  } catch {
    return 'missing-token';
  }
}

/**
 * Idempotency keys are stored in the email log, so they must never contain the raw secret
 * token from a verification / reset / invitation link. A short hash keeps them unique per token.
 */
function tokenFingerprint(url: string): string {
  return createHash('sha256').update(tokenFromUrl(url)).digest('hex').slice(0, 24);
}

/**
 * Single source of truth for an email's log fields. The Resend provider uses the
 * same subject and idempotency key when it sends, so the log row and the actual
 * message always agree, and a retried send reuses the provider-side idempotency key.
 */
export function describeMail<K extends QueuedMailKind>(
  kind: K,
  command: QueuedMailCommands[K],
): MailDescriptor {
  const c = command as unknown as AnyQueuedMailCommand;
  const hotelName = c.brand?.name || 'your hotel';
  switch (kind) {
    case 'paymentConfirmation':
      return {
        eventType: 'booking.confirmed',
        recipient: c.to,
        subject: `${hotelName} booking confirmed — ${c.bookingReference}`,
        idempotencyKey: `payment-confirmation/${c.paymentId}`,
        bookingId: c.bookingId,
        sensitive: false,
      };
    case 'newBookingStaff':
      return {
        eventType: 'booking.staff_new',
        recipient: c.to,
        subject: `${c.guest.name} — new booking ${c.bookingReference}`,
        idempotencyKey: `new-booking-staff/${c.paymentId}/${c.staffUserId}`,
        bookingId: c.bookingId,
        sensitive: false,
      };
    case 'refundConfirmation':
      return {
        eventType: 'booking.refund_processed',
        recipient: c.to,
        subject: `${hotelName} refund processed — ${c.bookingReference}`,
        idempotencyKey: `refund-confirmation/${c.refundId}`,
        bookingId: c.bookingId,
        sensitive: false,
      };
    case 'bookingCancelled':
      return {
        eventType: 'booking.cancelled',
        recipient: c.to,
        subject: `Booking ${c.bookingReference} cancelled`,
        idempotencyKey: `booking-cancelled/guest/${c.bookingId}`,
        bookingId: c.bookingId,
        sensitive: false,
      };
    case 'bookingCancelledStaff':
      return {
        eventType: 'booking.staff_cancelled',
        recipient: c.to,
        subject: `${c.guest.name} — booking cancelled ${c.bookingReference}`,
        idempotencyKey: `booking-cancelled/staff/${c.bookingId}/${c.staffUserId}`,
        bookingId: c.bookingId,
        sensitive: false,
      };
    case 'verification':
      return {
        eventType: 'account.verification',
        recipient: c.to,
        subject: 'Verify your MUST Booking email address',
        idempotencyKey: `email-verification/${c.userId}/${tokenFingerprint(c.verificationUrl)}`,
        bookingId: null,
        sensitive: true,
      };
    case 'welcome':
      return {
        eventType: 'account.welcome',
        recipient: c.to,
        subject: 'Welcome to MUST Booking',
        idempotencyKey: `welcome/${c.userId}`,
        bookingId: null,
        sensitive: false,
      };
    case 'passwordReset':
      return {
        eventType: 'account.password_reset',
        recipient: c.to,
        subject: 'Reset your MUST Booking password',
        idempotencyKey: `password-reset/${c.userId}/${tokenFingerprint(c.resetUrl)}`,
        bookingId: null,
        sensitive: true,
      };
    case 'staffInvitation':
      return {
        eventType: 'staff.invitation',
        recipient: c.to,
        subject: `You're invited to join ${c.organizationName} on MUST Booking`,
        idempotencyKey: `staff-invitation/${tokenFingerprint(c.invitationUrl)}`,
        bookingId: null,
        sensitive: true,
      };
  }
}
