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

import { IntegrationConnectionsService } from '../integrations/integration-connections.service';

type PokPayOrder = {
  id?: string;
  transactionId?: string | null;
  amount?: number | string;
  finalAmount?: number | string;
  currencyCode?: string;
  status?: string;
  isCompleted?: boolean;
  isRefunded?: boolean;
  isCanceled?: boolean;
  refundableAmount?: number | string;
  _self?: { confirmUrl?: string };
};

type PokPayResponse = { data?: { accessToken?: string; sdkOrder?: PokPayOrder }; message?: string };
type PokPayConfiguration = {
  baseUrl: string;
  keyId: string;
  keySecret: string;
  merchantId: string;
  webhookUrl: string;
};

@Injectable()
export class PokPayPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(PokPayPaymentProvider.name);

  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
  ) {}

  async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    const configuration = this.healthConfiguration();
    if (!configuration.ok) return { ok: false, error: configuration.error.message };

    const authenticated = await this.authenticate(configuration.value);
    return authenticated.ok ? { ok: true } : { ok: false, error: authenticated.error.message };
  }

  async createCheckoutSession(
    context: PaymentProviderContext,
    command: CreateCheckoutSessionCommand,
  ): Promise<Result<CheckoutSession>> {
    const configuration = await this.configuration(context);
    if (!configuration.ok) return configuration;

    const authenticated = await this.authenticatedRequest(configuration.value, {
      method: 'POST',
      path: `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders`,
      body: {
        amount: this.pokpayAmount(command.amount.amount),
        currencyCode: command.amount.currency,
        autoCapture: true,
        shippingCost: 0,
        webhookUrl: configuration.value.webhookUrl,
        redirectUrl: command.successUrl,
        failRedirectUrl: command.cancelUrl,
        merchantCustomReference: command.bookingId,
        description: `Hotel booking ${command.bookingId}`,
      },
    });
    if (!authenticated.ok) return authenticated;
    const order = authenticated.value.data?.sdkOrder;
    if (!order?.id || !order._self?.confirmUrl)
      return this.failure(
        'POKPAY_ORDER_INVALID',
        'PokPay did not return an SDK order with a checkout URL.',
        true,
      );

    return { ok: true, value: { id: order.id, url: order._self.confirmUrl } };
  }

  // PokPay documents no signed webhook format. Callers must bind the supplied order id to a
  // local session and use getPayment()'s authenticated provider re-read as the trust boundary.
  async verifyWebhookEvent(
    context: PaymentProviderContext,
    rawBody: Uint8Array,
    signature: string,
  ): Promise<Result<PaymentWebhookEvent>> {
    void context;
    void rawBody;
    void signature;
    return this.failure(
      'POKPAY_AUTHORITATIVE_REREAD_REQUIRED',
      'PokPay callbacks must be verified by an authenticated order re-read.',
    );
  }

  // Confirmed for real against PokPay staging 2026-09-30: the sdk-orders refund
  // endpoint takes `refundAmount` in the merchant's settlement currency (Lek),
  // not in the order's currency. Sending 100 for a 250 EUR order refunded
  // 100 Lek (about 1.10 EUR) and left `refundableAmount` at 22650 (250 EUR =
  // 22750 Lek). So the guest's money is returned in the currency they paid
  // by converting at the order's own implied rate: `refundableAmount` (Lek)
  // over what is still refundable in the order's currency (paid minus refunds
  // already recorded). An ALL order comes out at a rate of 1. The result is
  // re-read afterwards and the refund is reported as failed, never silently
  // recorded as complete, if PokPay moved a different amount than requested.
  async refund(context: PaymentProviderContext, command: RefundCommand): Promise<Result<Payment>> {
    const configuration = await this.configuration(context);
    if (!configuration.ok) return configuration;
    const orderPath = `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders/${encodeURIComponent(command.paymentId)}`;

    const before = await this.authenticatedRequest(configuration.value, {
      method: 'GET',
      path: orderPath,
    });
    if (!before.ok) return before;
    const current = before.value.data?.sdkOrder;
    const paid = Number(current?.finalAmount ?? current?.amount);
    const refundableLek = Number(current?.refundableAmount);
    const requested = Number(command.amount.amount);
    const alreadyRefunded = Number(command.alreadyRefunded?.amount ?? 0);
    if (!current?.id || !Number.isFinite(paid) || !Number.isFinite(refundableLek))
      return this.failure(
        'POKPAY_REFUND_UNVERIFIABLE',
        'PokPay did not return the order amounts needed to size this refund safely.',
      );
    if (current.currencyCode !== command.amount.currency)
      return this.failure(
        'POKPAY_REFUND_CURRENCY_MISMATCH',
        `The order was paid in ${current.currencyCode ?? 'an unknown currency'}; a refund must be in the same currency.`,
      );
    const remaining = paid - alreadyRefunded;
    if (!(requested > 0) || requested > remaining + 0.005)
      return this.failure(
        'INVALID_REFUND_AMOUNT',
        'Refund amount exceeds what is still refundable on the PokPay order.',
      );
    const rate = refundableLek / remaining;
    const refundLek = Math.round(requested * rate * 100) / 100;
    if (!Number.isFinite(rate) || rate <= 0 || !(refundLek > 0))
      return this.failure(
        'POKPAY_REFUND_UNVERIFIABLE',
        'PokPay refund amount could not be derived from the order.',
      );

    const response = await this.authenticatedRequest(configuration.value, {
      method: 'POST',
      path: `${orderPath}/refund`,
      body: { refundAmount: refundLek, refundReason: 'Hotel booking refund' },
    });
    if (!response.ok) return response;
    const order = response.value.data?.sdkOrder;
    if (!order?.id)
      return this.failure('POKPAY_REFUND_INVALID', 'PokPay did not return a refund order.', true);

    const after = await this.authenticatedRequest(configuration.value, {
      method: 'GET',
      path: orderPath,
    });
    const refundableAfter = after.ok
      ? Number(after.value.data?.sdkOrder?.refundableAmount)
      : Number.NaN;
    if (!Number.isFinite(refundableAfter) || Math.abs(refundableLek - refundLek - refundableAfter) > 0.02) {
      this.logger.error(
        `PokPay refund for order ${order.id} sent ${refundLek} but refundableAmount went ${refundableLek} -> ${refundableAfter}; verify in the PokPay dashboard.`,
      );
      return this.failure(
        'POKPAY_REFUND_AMOUNT_MISMATCH',
        'PokPay accepted the refund but the order does not show the expected amount returned. Verify it in the PokPay dashboard before retrying.',
      );
    }
    return {
      ok: true,
      value: {
        id: order.transactionId || `${order.id}:refund`,
        bookingId: command.paymentId,
        amount: command.amount,
        status: order.isRefunded ? 'REFUNDED' : 'REFUND_PENDING',
      },
    };
  }

  async getPayment(context: PaymentProviderContext, paymentId: string): Promise<Payment | null> {
    const configuration = await this.configuration(context);
    if (!configuration.ok) return null;
    const response = await this.authenticatedRequest(configuration.value, {
      method: 'GET',
      path: `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders/${encodeURIComponent(paymentId)}`,
    });
    if (!response.ok) return null;
    const order = response.value.data?.sdkOrder;
    if (!order?.id || order.amount === undefined || !order.currencyCode) return null;
    return {
      id: order.id,
      bookingId: paymentId,
      amount: {
        amount: this.decimalAmount(order.finalAmount ?? order.amount),
        currency: order.currencyCode,
      },
      status: this.status(order),
    };
  }

  /** Reads the tenant's own PokPay connection for this property (ADR-0026) —
   * never the server environment. A property with no enabled PokPay
   * connection cannot take PokPay payments, same as having none configured. */
  private async configuration(
    context: PaymentProviderContext,
  ): Promise<Result<PokPayConfiguration>> {
    const credentials = await this.connections.activePaymentConnectionCredentials(
      context.tenantId,
      context.propertyId,
      'POKPAY',
    );
    const keyId = credentials?.keyId?.trim();
    const keySecret = credentials?.keySecret?.trim();
    const merchantId = credentials?.merchantId?.trim();
    const webhookUrl = credentials?.webhookUrl?.trim();
    const baseUrl = (credentials?.baseUrl?.trim() || 'https://api-staging.pokpay.io').replace(
      /\/$/,
      '',
    );
    if (!keyId || !keySecret || !merchantId || !webhookUrl)
      return this.failure('POKPAY_NOT_CONFIGURED', 'PokPay is not configured for this property.');
    if (baseUrl !== 'https://api-staging.pokpay.io')
      return this.failure(
        'POKPAY_TEST_MODE_REQUIRED',
        'Only PokPay staging may be used at this stage.',
      );
    try {
      new URL(webhookUrl);
    } catch {
      return this.failure('POKPAY_WEBHOOK_URL_INVALID', 'webhookUrl must be a valid URL.');
    }
    return { ok: true, value: { baseUrl, keyId, keySecret, merchantId, webhookUrl } };
  }

  private healthConfiguration(): Result<PokPayConfiguration> {
    const keyId = process.env.POKPAY_KEY_ID?.trim();
    const keySecret = process.env.POKPAY_KEY_SECRET?.trim();
    const merchantId = process.env.POKPAY_MERCHANT_ID?.trim();
    const baseUrl = (
      process.env.POKPAY_API_BASE_URL?.trim() || 'https://api-staging.pokpay.io'
    ).replace(/\/$/, '');
    if (!keyId || !keySecret || !merchantId)
      return this.failure('POKPAY_NOT_CONFIGURED', 'PokPay is not configured for health checks.');
    if (baseUrl !== 'https://api-staging.pokpay.io')
      return this.failure(
        'POKPAY_TEST_MODE_REQUIRED',
        'Only PokPay staging may be used at this stage.',
      );
    return {
      ok: true,
      value: { baseUrl, keyId, keySecret, merchantId, webhookUrl: '' },
    };
  }

  private async authenticatedRequest(
    configuration: PokPayConfiguration,
    request: { method: 'GET' | 'POST'; path: string; body?: object },
  ): Promise<Result<PokPayResponse>> {
    try {
      const authenticated = await this.authenticate(configuration);
      if (!authenticated.ok) return authenticated;

      const token = authenticated.value;
      const response = await fetch(`${configuration.baseUrl}${request.path}`, {
        method: request.method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const rawBody = await response.text();
      if (!response.ok) {
        this.logger.warn(
          `PokPay ${request.method} ${request.path} failed: status=${response.status} body=${rawBody.slice(0, 500)}`,
        );
        return this.failure(
          'POKPAY_REQUEST_FAILED',
          'PokPay could not process the payment request.',
          response.status >= 500,
        );
      }
      const body = JSON.parse(rawBody) as PokPayResponse;
      return { ok: true, value: body };
    } catch (error) {
      this.logger.warn(
        `PokPay ${request.method} ${request.path} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.failure(
        'POKPAY_REQUEST_FAILED',
        'PokPay could not process the payment request.',
        true,
      );
    }
  }

  private async authenticate(configuration: PokPayConfiguration): Promise<Result<string>> {
    try {
      const login = await fetch(`${configuration.baseUrl}/auth/sdk/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId: configuration.keyId, keySecret: configuration.keySecret }),
      });
      const rawBody = await login.text();
      const loginBody = (() => {
        try {
          return JSON.parse(rawBody) as PokPayResponse;
        } catch {
          return null;
        }
      })();
      const token = loginBody?.data?.accessToken;
      if (!login.ok || !token) {
        this.logger.warn(
          `PokPay auth failed for keyId ${configuration.keyId}: status=${login.status} body=${rawBody.slice(0, 500)}`,
        );
        return this.failure('POKPAY_AUTH_FAILED', 'PokPay authentication failed.', true);
      }
      return { ok: true, value: token };
    } catch (error) {
      this.logger.warn(
        `PokPay auth threw for keyId ${configuration.keyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.failure('POKPAY_AUTH_FAILED', 'PokPay authentication failed.', true);
    }
  }

  private status(order: PokPayOrder): string {
    if (order.isRefunded) return 'REFUNDED';
    if (order.isCanceled) return 'CANCELLED';
    if (order.isCompleted) return 'COMPLETED';
    return order.status?.toUpperCase() || 'PENDING';
  }

  // PokPay's own API docs (payments.doc.pokpay.io, "Create an Order") show
  // `amount` sent and returned as the raw currency value directly (e.g. 100
  // for 100.00 EUR) — there is no minor-units/cents convention, unlike
  // Stripe. Confirmed for real: sending 900.00 EUR as 90000 triggered
  // PokPay's own "maximum amount of 1000 EUR" rejection.
  private pokpayAmount(amount: string): number {
    return Number(amount);
  }

  private decimalAmount(amount: number | string): string {
    return Number(amount).toFixed(2);
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
