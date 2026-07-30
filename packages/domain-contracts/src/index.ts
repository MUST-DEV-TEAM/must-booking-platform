import type { PropertyContext, TenantContext } from '@must/shared-types';

export type PmsProviderContext = PropertyContext;
export type BillingProviderContext = TenantContext;
export type PaymentProviderContext = PropertyContext;

export interface MailProvider {
  sendVerificationEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
    verificationUrl: string;
  }): Promise<void>;
  sendWelcomeEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
  }): Promise<void>;
}

export interface StorageProvider {
  createPresignedUpload(command: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ uploadUrl: string }>;
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

export interface GuestDetails {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface Booking {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  guestId: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  total: Money;
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
  externalReference: string;
  roomTypeId: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  guest: GuestDetails;
  total: Money;
}

export interface UpdateBookingCommand {
  idempotencyKey: string;
  bookingId: string;
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
  expectedVersion: number;
  reason: string | null;
}

export interface PmsProvider {
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
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface RefundCommand {
  idempotencyKey: string;
  paymentId: string;
  amount: Money;
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
  paymentId: string;
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
