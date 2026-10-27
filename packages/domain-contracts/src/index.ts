import type { PropertyContext, TenantContext } from '@must/shared-types';

export type PmsProviderContext = PropertyContext;
export type BillingProviderContext = TenantContext;
export type PaymentProviderContext = PropertyContext;

/** Returned by transports that can report the provider-side message id (used by the email log). */
export type MailSendReceipt = {
  providerMessageId?: string;
  provider?: 'resend' | 'smtp';
  usedFallback?: boolean;
};

export interface MailProvider {
  sendVerificationEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
    verificationUrl: string;
  }): Promise<MailSendReceipt | void>;
  sendWelcomeEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
  }): Promise<MailSendReceipt | void>;
  sendPasswordResetEmail(command: {
    userId: string;
    to: string;
    resetUrl: string;
  }): Promise<MailSendReceipt | void>;
  sendStaffInvitationEmail(command: {
    to: string;
    template?: MailTemplateOverride;
    brand?: MailBrand;
    organizationName: string;
    invitedByEmail: string;
    assignments: Array<{ propertyName: string; roleTemplateName: string }>;
    invitationUrl: string;
  }): Promise<MailSendReceipt | void>;
  sendPaymentConfirmationEmail(command: {
    bookingId: string;
    bookingReference: string;
    paymentId: string;
    to: string;
    amount: Money;
    brand: MailBrand;
    paymentMethod: GuestPaymentMethod;
    guest: { name: string };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    guestCount: number;
    nightlyRates?: NightlyRate[];
    /** Every room of a multi-room order; absent or a single entry for a one-room booking. */
    rooms?: MailOrderRoom[];
    cancellationUrl?: string;
    specialRequests?: string | null;
    /** The property's own subject and message, when it saved one. */
    template?: MailTemplateOverride;
  }): Promise<MailSendReceipt | void>;
  sendNewBookingStaffNotification(command: {
    bookingId: string;
    bookingReference: string;
    paymentId: string;
    staffUserId: string;
    to: string;
    template?: MailTemplateOverride;
    guest: { name: string; email: string; phone: string | null };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    amount: Money;
    brand: MailBrand;
    guestCount: number;
    paymentMethod: GuestPaymentMethod;
    nightlyRates?: NightlyRate[];
    rooms?: MailOrderRoom[];
    specialRequests?: string | null;
  }): Promise<MailSendReceipt | void>;
  sendRefundConfirmationEmail(command: {
    bookingId: string;
    bookingReference: string;
    refundId: string;
    to: string;
    amount: Money;
    brand: MailBrand;
    guest: { name: string };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    guestCount: number;
    nightlyRates?: NightlyRate[];
    template?: MailTemplateOverride;
  }): Promise<MailSendReceipt | void>;
  sendBookingCancelledEmail(command: {
    bookingId: string;
    bookingReference: string;
    to: string;
    brand: MailBrand;
    guest: { name: string };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    guestCount: number;
    nightlyRates?: NightlyRate[];
    template?: MailTemplateOverride;
  }): Promise<MailSendReceipt | void>;
  /** An email whose subject and body were already rendered by the caller. */
  sendRenderedEmail(command: RenderedEmailCommand): Promise<MailSendReceipt | void>;
  sendBookingCancelledStaffNotification(command: {
    bookingId: string;
    bookingReference: string;
    staffUserId: string;
    to: string;
    template?: MailTemplateOverride;
    brand: MailBrand;
    guest: { name: string; email: string; phone: string | null };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    guestCount: number;
    nightlyRates?: NightlyRate[];
    refund?: {
      status: 'processed' | 'manual_action';
      amount: Money;
      paymentMethod: string | null;
    };
  }): Promise<MailSendReceipt | void>;
}

export type RenderedEmailCommand = {
  /** Log event type, e.g. `guest.pre_arrival`. */
  eventType: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  bookingId: string | null;
  /** Where replies go, e.g. the hotel's own address. */
  replyTo?: string | null;
  /** Sender name shown to the recipient, e.g. the hotel's name; the address stays ours. */
  fromName?: string | null;
};

/** A property's own wording for a guest email, already filled in and escaped. */
export type MailTemplateOverride = {
  hasStayBlock?: boolean;
  subject: string;
  html: string;
  text: string;
  previewText?: string;
};

export type MailOrderRoom = {
  roomName: string;
  guestCount: number;
  amount: Money;
};

export type MailBrand = {
  /** Approved hotel email identity; does not change the property name in content. */
  senderName?: string | null;
  replyTo?: string | null;
  name: string;
  logoUrl?: string | null;
  supportEmail?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  address?: string | null;
};

export interface StorageProvider {
  /** Providers that transform uploads choose the stored extension before reserving the key. */
  readonly uploadExtension?: string;
  uploadObject?(key: string, data: Uint8Array, contentType: string): Promise<void>;
  objectExists?(key: string): Promise<boolean>;
  createPresignedUpload(command: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ uploadUrl: string }>;
  deleteObject(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export enum BookingStatus {
  DRAFT = 'DRAFT',
  QUOTED = 'QUOTED',
  INVENTORY_REVALIDATING = 'INVENTORY_REVALIDATING',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_NOT_REQUIRED = 'PAYMENT_NOT_REQUIRED',
  PMS_CREATION_PENDING = 'PMS_CREATION_PENDING',
  PMS_CONFIRMATION_PENDING = 'PMS_CONFIRMATION_PENDING',
  CONFIRMED = 'CONFIRMED',
  AVAILABILITY_FAILED = 'AVAILABILITY_FAILED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PMS_UNKNOWN_RESULT = 'PMS_UNKNOWN_RESULT',
  PMS_REJECTED = 'PMS_REJECTED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BookingPaymentMethod {
  STRIPE_CHECKOUT = 'STRIPE_CHECKOUT',
  POKPAY = 'POKPAY',
  PAY_AT_HOTEL = 'PAY_AT_HOTEL',
  FREE = 'FREE',
}

export type GuestPaymentMethod = 'stripe' | 'pokpay' | 'pay_at_hotel';

export interface ResultError {
  code: string;
  message: string;
  retryable: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ResultError };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Money {
  amount: string;
  currency: string;
}

/** An immutable price for one occupied calendar date, as quoted to the guest. */
export interface NightlyRate {
  date: string;
  amount: string;
}

export interface GuestDetails {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  streetAddress?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  specialRequests?: string | null;
}

export interface Booking {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomId: string | null;
  guestId: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  total: Money;
  adults: number;
  children: number;
  /** Derived from adults + children; retained for backwards compatibility. */
  guestCount: number;
  /** The per-night quote snapshot, when the booking was created from a guest quote. */
  nightlyRates?: NightlyRate[];
  externalReference: string;
  externalBookingId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityQuery {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  adultCount?: number;
  childrenCount?: number;
}

export interface AvailabilityResult {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
  availableUnits: number;
}

export interface CatalogRoomType {
  kind: 'room_type';
  id: string;
  name: string;
  maxOccupancy: number;
}

export interface CatalogRatePlan {
  kind: 'rate_plan';
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
}

export type CatalogItem = CatalogRoomType | CatalogRatePlan;

export interface CreateBookingCommand {
  idempotencyKey: string;
  externalReference?: string;
  roomTypeId: string;
  roomId?: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  guest: GuestDetails;
  total: Money;
  adults?: number;
  children?: number;
  /** Legacy input; used as a fallback only when adults/children are absent. */
  guestCount?: number;
  paymentMethod?: GuestPaymentMethod;
  payAtHotel?: boolean;
}

export interface UpdateBookingCommand {
  idempotencyKey: string;
  bookingId: string;
  guestSessionId?: string;
  expectedVersion: number;
  roomTypeId?: string;
  ratePlanId?: string;
  startsOn?: string;
  endsOn?: string;
  guest?: GuestDetails;
  total?: Money;
}

export interface CancelBookingCommand {
  idempotencyKey: string;
  bookingId: string;
  guestSessionId?: string;
  expectedVersion: number;
  reason: string | null;
  /** Present only for an authenticated staff cancellation. */
  staffActorId?: string;
  /** Staff chose the refund themselves, so the cancellation policy must not refund automatically. */
  skipAutomaticRefund?: boolean;
}

export interface MoveBookingRoomCommand {
  bookingId: string;
  roomId: string;
  expectedVersion: number;
  idempotencyKey: string;
  staffActorId: string;
  reason: string;
}

export interface StayAmendmentQuery {
  roomTypeId?: string;
  bookingId: string;
  startsOn: string;
  endsOn: string;
}
export interface StayAmendmentCommand extends StayAmendmentQuery {
  notifyGuest?: boolean;
  termsReviewed?: boolean;
  expectedVersion: number;
  previewHash: string;
  reason: string;
  idempotencyKey: string;
  staffActorId: string;
  outcome?: string;
  outcomeReason?: string;
}
export interface StayAmendmentPreview {
  roomTypeId?: string;
  roomTypeName?: string;
  rateId?: string;
  confirmationAvailable?: boolean;
  bookingId: string;
  startsOn: string;
  endsOn: string;
  nights: number;
  available: boolean;
  oldTotal: string;
  newTotal: string;
  recordedTotal: string;
  difference: string;
  currency: string;
  paid: string;
  refunded: string;
  balance: string;
  balanceState: string;
  policyNotes: string[];
  version: number;
  previewHash: string;
  outcome: string;
  outcomeReason: string;
  availableOutcomes: string[];
  canRefund: boolean;
  refundToIssue: string;
}
export interface RoomMoveAvailabilityQuery {
  roomIds: string[];
  startsOn: string;
  endsOn: string;
  excludeBookingId: string;
  excludeExternalBookingId?: string;
}
export interface RoomMoveAvailabilitySnapshot {
  unavailableRoomIds: string[];
  source: 'LOCAL' | 'CLOCK_SNAPSHOT';
  lastSyncedAt: string | null;
  complete: boolean;
  stale: boolean;
}
export interface PmsProvider {
  unavailableRoomsForMove?(
    context: PmsProviderContext,
    query: RoomMoveAvailabilityQuery,
  ): Promise<Result<RoomMoveAvailabilitySnapshot>>;

  previewStayAmendment?(
    context: PmsProviderContext,
    query: StayAmendmentQuery,
  ): Promise<Result<StayAmendmentPreview>>;
  amendBookingStay?(
    context: PmsProviderContext,
    command: StayAmendmentCommand,
  ): Promise<Result<Booking>>;
  moveBookingRoom?(
    context: PmsProviderContext,
    command: MoveBookingRoomCommand,
  ): Promise<Result<Booking>>;
  testConnection(context: PmsProviderContext): Promise<Result<void>>;
  syncCatalog(context: PmsProviderContext, cursor?: string): Promise<Page<CatalogItem>>;
  getAvailability(
    context: PmsProviderContext,
    query: AvailabilityQuery,
  ): Promise<Result<AvailabilityResult>>;
  getBooking(context: PmsProviderContext, externalBookingId: string): Promise<Booking | null>;
  findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<Booking | null>;
  createBooking(
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<Result<Booking>>;
  updateBooking(
    context: PmsProviderContext,
    command: UpdateBookingCommand,
  ): Promise<Result<Booking>>;
  cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
  ): Promise<Result<Booking>>;
}

export interface BillingProvider {
  createCustomer(context: BillingProviderContext, tenant: unknown): Promise<unknown>;
  createSubscription(context: BillingProviderContext, planId: string): Promise<unknown>;
  changePlan(
    context: BillingProviderContext,
    subscriptionId: string,
    newPlanId: string,
  ): Promise<unknown>;
  cancelSubscription(context: BillingProviderContext, subscriptionId: string): Promise<unknown>;
  getSubscription(context: BillingProviderContext, subscriptionId: string): Promise<unknown | null>;
  handleWebhook(context: BillingProviderContext, event: unknown): Promise<unknown>;
}

export interface CreateCheckoutSessionCommand {
  idempotencyKey: string;
  bookingId: string;
  amount: Money;
  successUrl: string;
  cancelUrl: string;
  /** How long the payment page stays usable. Omitted: the provider default. */
  expiresAfterMinutes?: number;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface RefundCommand {
  idempotencyKey: string;
  paymentId: string;
  amount: Money;
  /** Sum of refunds already recorded against this charge, in the charge's currency. */
  alreadyRefunded?: Money;
}

export interface Payment {
  id: string;
  bookingId: string;
  amount: Money;
  status: string;
}

export interface PaymentWebhookEvent {
  id: string;
  type: string;
  externalPaymentId: string;
  tenantId?: string;
  propertyId?: string;
  bookingId?: string;
  paymentStatus?: string;
}

export interface PaymentProvider {
  createCheckoutSession(
    context: PaymentProviderContext,
    command: CreateCheckoutSessionCommand,
  ): Promise<Result<CheckoutSession>>;
  verifyWebhookEvent(
    context: PaymentProviderContext,
    rawBody: Uint8Array,
    signature: string,
  ): Promise<Result<PaymentWebhookEvent>>;
  refund(context: PaymentProviderContext, command: RefundCommand): Promise<Result<Payment>>;
  getPayment(context: PaymentProviderContext, paymentId: string): Promise<Payment | null>;
}

/** Email plan Step 1: who receives each notification at a property. */
export type NotificationRecipientChannel = 'TO' | 'CC' | 'BCC';
export type NotificationRecipientRule = { channel?: NotificationRecipientChannel } & (
  | { target: 'MEMBERSHIP_ROLE'; membershipRole: 'OWNER' | 'ADMIN' }
  | { target: 'ROLE_TEMPLATE'; roleTemplateId: string }
  | { target: 'STAFF_USER'; userId: string }
  | { target: 'EMAIL'; email: string }
);

export interface NotificationTopicSettings {
  topic: string;
  label: string;
  /** Whether this topic has a guest email / a staff email at all. */
  hasGuestEmail: boolean;
  hasStaffEmail: boolean;
  guestEnabled: boolean;
  /** Whether the staff email is sent at all. */
  staffEnabled: boolean;
  /** False: staff recipients follow the topic's default (e.g. assigned staff, else owners/admins). */
  customStaffRecipients: boolean;
  /** Existing lists stay private until explicit header choices are saved. */
  staffDeliveryMode?: 'PRIVATE' | 'HEADERS';
  /** For scheduled emails: days before arrival / after departure, with its allowed range. */
  daysOffset: { value: number; min: number; max: number; label: string } | null;
  rules: NotificationRecipientRule[];
  /** Who gets the staff email today, after applying the rules. */
  staffRecipients: Array<{ email: string; channel?: NotificationRecipientChannel }>;
}

export interface NotificationSettingsResponse {
  topics: NotificationTopicSettings[];
  options: {
    roleTemplates: Array<{ id: string; name: string }>;
    staff: Array<{
      userId: string;
      email: string;
      name?: string;
      role: 'OWNER' | 'ADMIN' | 'STAFF';
    }>;
  };
}

export interface UpdateNotificationTopicCommand {
  guestEnabled: boolean;
  /** Defaults to true when omitted. */
  staffEnabled?: boolean;
  customStaffRecipients: boolean;
  rules: NotificationRecipientRule[];
  /** Only for scheduled topics; omitted keeps the default. */
  daysOffset?: number | null;
}

export * from './capture';
