import type { PropertyContext, TenantContext } from '@must/shared-types';

export type PmsProviderContext = PropertyContext;
export type BillingProviderContext = TenantContext;

export interface PmsProvider {
  testConnection(context: PmsProviderContext): Promise<unknown>;
  syncCatalog(context: PmsProviderContext, cursor?: string): Promise<unknown>;
  getAvailability(context: PmsProviderContext, query: unknown): Promise<unknown>;
  getBooking(context: PmsProviderContext, externalBookingId: string): Promise<unknown | null>;
  findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<unknown | null>;
  createBooking(context: PmsProviderContext, command: unknown): Promise<unknown>;
  updateBooking(context: PmsProviderContext, command: unknown): Promise<unknown>;
  cancelBooking(context: PmsProviderContext, command: unknown): Promise<unknown>;
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
