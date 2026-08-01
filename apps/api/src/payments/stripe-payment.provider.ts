import { Injectable } from '@nestjs/common';
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

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  async createCheckoutSession(
    context: PaymentProviderContext,
    command: CreateCheckoutSessionCommand,
  ): Promise<Result<CheckoutSession>> {
    const secretKey = this.secretKey();
    if (!secretKey) {
      return this.failure(
        'STRIPE_NOT_CONFIGURED',
        'Stripe checkout is not configured for this environment.',
      );
    }
    if (!secretKey.startsWith('sk_test_')) {
      return this.failure(
        'STRIPE_TEST_MODE_REQUIRED',
        'Only a Stripe test-mode secret key may be used at this stage.',
      );
    }

    try {
      const session = await new Stripe(secretKey).checkout.sessions.create(
        {
          mode: 'payment',
          submit_type: 'book',
          client_reference_id: command.bookingId,
          success_url: command.successUrl,
          cancel_url: command.cancelUrl,
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
      if (!session.url) {
        return this.failure(
          'STRIPE_CHECKOUT_URL_MISSING',
          'Stripe did not return a checkout URL.',
          true,
        );
      }
      return { ok: true, value: { id: session.id, url: session.url } };
    } catch {
      return this.failure(
        'STRIPE_CHECKOUT_CREATION_FAILED',
        'Stripe checkout could not be created.',
        true,
      );
    }
  }

  async verifyWebhookEvent(
    context: PaymentProviderContext,
    rawBody: Uint8Array,
    signature: string,
  ): Promise<Result<PaymentWebhookEvent>> {
    void context;
    const secretKey = this.secretKey();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secretKey || !webhookSecret) {
      return this.failure(
        'STRIPE_WEBHOOK_NOT_CONFIGURED',
        'Stripe webhook verification is not configured for this environment.',
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
    void context;
    const secretKey = this.secretKey();
    if (!secretKey) {
      return this.failure('STRIPE_NOT_CONFIGURED', 'Stripe refunds are not configured.');
    }
    if (!secretKey.startsWith('sk_test_')) {
      return this.failure(
        'STRIPE_TEST_MODE_REQUIRED',
        'Only a Stripe test-mode secret key may be used at this stage.',
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

  async getPayment(context: PaymentProviderContext, paymentId: string): Promise<Payment | null> {
    void context;
    void paymentId;
    return null;
  }

  private secretKey(): string | null {
    const value = process.env.STRIPE_SECRET_KEY?.trim();
    return value || null;
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
