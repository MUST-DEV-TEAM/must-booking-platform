import { isStripeTestKey } from '../integrations/connection-mode';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CheckoutSession,
  type CreateCheckoutSessionCommand,
  type Payment,
  type PaymentProvider,
  type PaymentProviderContext,
  type PaymentWebhookEvent,
  type RefundCommand,
  type Result,
} from '@must/domain-contracts';
import Stripe from 'stripe';

import { IntegrationConnectionsService } from '../integrations/integration-connections.service';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(StripePaymentProvider.name);

  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
  ) {}

  // Platform-wide diagnostic (provider-health.service.ts), not tenant-scoped —
  // intentionally still reads the server environment, unlike the tenant-facing
  // methods below (ADR-0026: guest checkout uses the tenant's own connection).
  async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    const secretKey = this.platformSecretKey();
    if (!secretKey) return { ok: false, error: 'Stripe is not configured.' };

    try {
      await new Stripe(secretKey).balance.retrieve();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Stripe balance check failed.' };
    }
  }

  async createCheckoutSession(
    context: PaymentProviderContext,
    command: CreateCheckoutSessionCommand,
  ): Promise<Result<CheckoutSession>> {
    const configured = await this.tenantConnection(context);
    if (!configured.ok) return configured;
    const { secretKey, connectionId, publishableKey } = configured.value;
    if (!isStripeTestKey(secretKey)) {
      return this.failure(
        'STRIPE_TEST_MODE_REQUIRED',
        'Only a Stripe test-mode key (sk_test_ or rk_test_) may be used at this stage.',
      );
    }

    try {
      // The website can show Stripe's checkout inside its own page when this hotel saved its
      // publishable key; without one, the guest goes to Stripe's own page as before.
      const embedded = command.embedded === true && !!publishableKey;
      const session = await new Stripe(secretKey).checkout.sessions.create(
        {
          mode: 'payment',
          submit_type: 'book',
          client_reference_id: command.bookingId,
          // The guest pays in the hotel's own currency: no local-currency offer with a conversion fee, so the
          // ledger, the refunds and the hotel's balance all count the same amount (owner, 2026-11-16).
          adaptive_pricing: { enabled: false },
          ...(embedded
            ? {
                ui_mode: 'embedded_page' as const,
                return_url: command.successUrl,
                // Cards finish inside the page (the page is told); redirect methods use return_url.
                redirect_on_completion: 'if_required' as const,
              }
            : { success_url: command.successUrl, cancel_url: command.cancelUrl }),
          metadata: this.bookingMetadata(context, command.bookingId),
          payment_intent_data: {
            metadata: this.bookingMetadata(context, command.bookingId),
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: command.amount.currency.toLowerCase(),
                unit_amount_decimal: this.amountInCents(command.amount.amount),
                product_data: { name: `Hotel booking ${command.bookingId}` },
              },
            },
          ],
        },
        { idempotencyKey: command.idempotencyKey },
      );
      if (embedded) {
        if (!session.client_secret)
          return this.failure(
            'STRIPE_CHECKOUT_URL_MISSING',
            'Stripe did not return an embedded checkout.',
            true,
          );
        return {
          ok: true,
          value: {
            id: session.id,
            url: '',
            connectionId,
            clientSecret: session.client_secret,
            publishableKey: publishableKey!,
          },
        };
      }
      if (!session.url) {
        return this.failure(
          'STRIPE_CHECKOUT_URL_MISSING',
          'Stripe did not return a checkout URL.',
          true,
        );
      }
      return { ok: true, value: { id: session.id, url: session.url, connectionId } };
    } catch (error) {
      // Stripe's own error text names the problem (and never contains a key); keep it for the operator.
      this.logger.warn(
        `Stripe checkout could not be created: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return this.failure(
        'STRIPE_CHECKOUT_CREATION_FAILED',
        'Stripe checkout could not be created.',
        true,
      );
    }
  }

  // Each hotel's Stripe connection has its own webhook secret. The public endpoint finds the
  // connection by its random webhook id, then passes that connection's keys here; nothing is read
  // from the server environment, so one hotel's secret can never verify another hotel's events.
  async verifyWebhookEvent(
    context: PaymentProviderContext & {
      stripeWebhook?: { secretKey: string; webhookSecret: string };
    },
    rawBody: Uint8Array,
    signature: string,
  ): Promise<Result<PaymentWebhookEvent>> {
    const secretKey = context.stripeWebhook?.secretKey.trim();
    const webhookSecret = context.stripeWebhook?.webhookSecret.trim();
    if (!secretKey || !webhookSecret) {
      return this.failure(
        'STRIPE_WEBHOOK_NOT_CONFIGURED',
        'This Stripe connection has no webhook secret saved.',
      );
    }
    if (!signature.trim()) {
      return this.failure('STRIPE_SIGNATURE_MISSING', 'The Stripe-Signature header is required.');
    }

    let event: Stripe.Event;
    try {
      event = new Stripe(secretKey).webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      return this.failure(
        'STRIPE_SIGNATURE_INVALID',
        'The Stripe webhook signature could not be verified.',
      );
    }

    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded'
    ) {
      return {
        ok: true,
        value: { id: event.id, type: event.type, externalPaymentId: event.id },
      };
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata;
    if (!metadata?.tenantId || !metadata.propertyId || !metadata.bookingId || !session.id) {
      return this.failure(
        'STRIPE_WEBHOOK_EVENT_INVALID',
        'The verified Stripe checkout event is missing booking metadata.',
      );
    }
    return {
      ok: true,
      value: {
        id: event.id,
        type: event.type,
        externalPaymentId: session.id,
        tenantId: metadata.tenantId,
        propertyId: metadata.propertyId,
        bookingId: metadata.bookingId,
        paymentStatus: session.payment_status,
      },
    };
  }

  async refund(context: PaymentProviderContext, command: RefundCommand): Promise<Result<Payment>> {
    // A refund goes through the account that took the payment, even if the hotel has since switched
    // to another one (test or live). Older sessions without a recorded account use the one in use.
    const configured = await this.tenantConnection(context, command.paymentId);
    if (!configured.ok) return configured;
    const secretKey = configured.value.secretKey;
    if (!isStripeTestKey(secretKey)) {
      return this.failure(
        'STRIPE_TEST_MODE_REQUIRED',
        'Only a Stripe test-mode key (sk_test_ or rk_test_) may be used at this stage.',
      );
    }

    try {
      const stripe = new Stripe(secretKey);
      const target = await this.refundTarget(stripe, command.paymentId);
      if (!target) {
        return this.failure(
          'STRIPE_PAYMENT_NOT_REFUNDABLE',
          'The original Stripe payment could not be refunded.',
        );
      }
      const refund = await stripe.refunds.create(
        {
          ...target,
          amount: this.amountInMinorUnits(command.amount.amount),
        },
        { idempotencyKey: command.idempotencyKey },
      );
      return {
        ok: true,
        value: {
          id: refund.id,
          bookingId: command.paymentId,
          amount: command.amount,
          status: refund.status ?? 'succeeded',
        },
      };
    } catch {
      return this.failure('STRIPE_REFUND_FAILED', 'Stripe refund could not be completed.', true);
    }
  }

  /**
   * Closes the guest's still-open Stripe page. A session that is already closed or paid counts as closed;
   * only a failure to reach Stripe asks the caller to try again.
   */
  async expireCheckout(
    context: PaymentProviderContext,
    externalPaymentId: string,
  ): Promise<Result<{ closed: boolean }>> {
    const configured = await this.tenantConnection(context, externalPaymentId);
    if (!configured.ok) return configured;
    try {
      await new Stripe(configured.value.secretKey).checkout.sessions.expire(externalPaymentId);
      return { ok: true, value: { closed: true } };
    } catch (error) {
      const stripeError = error as { type?: string; statusCode?: number; message?: string };
      // "Only open sessions can be expired": it is already expired or paid, nothing is left to close.
      if (stripeError.type === 'StripeInvalidRequestError' && stripeError.statusCode === 400)
        return { ok: true, value: { closed: true } };
      this.logger.warn(
        `Stripe checkout could not be closed: ${stripeError.message ?? 'unknown error'}`,
      );
      return { ok: true, value: { closed: false } };
    }
  }

  async getPayment(context: PaymentProviderContext, paymentId: string): Promise<Payment | null> {
    void context;
    void paymentId;
    return null;
  }

  private platformSecretKey(): string | null {
    const value = process.env.STRIPE_SECRET_KEY?.trim();
    return value || null;
  }

  /** Reads the tenant's own Stripe connection for this property (ADR-0026), never the server
   * environment: the account that took the given payment if it is recorded, otherwise the one in
   * use. A property with no usable Stripe connection cannot take Stripe payments. */
  private async tenantConnection(
    context: PaymentProviderContext,
    externalPaymentId?: string,
  ): Promise<Result<{ secretKey: string; connectionId: string; publishableKey?: string }>> {
    const connection =
      (externalPaymentId
        ? await this.connections.sessionPaymentConnection(
            context.tenantId,
            context.propertyId,
            'STRIPE',
            externalPaymentId,
          )
        : null) ??
      (await this.connections.activePaymentConnection(
        context.tenantId,
        context.propertyId,
        'STRIPE',
      ));
    const secretKey = connection?.credentials.secretKey?.trim();
    if (!connection || !secretKey)
      return this.failure(
        'STRIPE_NOT_CONFIGURED',
        'Stripe checkout is not configured for this property.',
      );
    const publishableKey = connection.credentials.publishableKey?.trim();
    return {
      ok: true,
      value: {
        secretKey,
        connectionId: connection.connectionId,
        ...(publishableKey ? { publishableKey } : {}),
      },
    };
  }

  private amountInCents(amount: string): Stripe.Decimal {
    const [whole, fraction = ''] = amount.split('.');
    return Stripe.Decimal.from(`${BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'))}`);
  }

  private amountInMinorUnits(amount: string): number {
    const [whole, fraction = ''] = amount.split('.');
    return Number(BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0')));
  }

  private async refundTarget(
    stripe: Stripe,
    externalPaymentId: string,
  ): Promise<{ charge: string } | { payment_intent: string } | null> {
    if (externalPaymentId.startsWith('ch_')) return { charge: externalPaymentId };
    if (externalPaymentId.startsWith('pi_')) return { payment_intent: externalPaymentId };
    if (!externalPaymentId.startsWith('cs_')) return null;
    const session = await stripe.checkout.sessions.retrieve(externalPaymentId);
    return typeof session.payment_intent === 'string'
      ? { payment_intent: session.payment_intent }
      : null;
  }

  private bookingMetadata(
    context: PaymentProviderContext,
    bookingId: string,
  ): Record<string, string> {
    return {
      bookingId,
      propertyId: context.propertyId,
      tenantId: context.tenantId,
    };
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
