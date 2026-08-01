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
  async createCheckoutSession(
    context: PaymentProviderContext,
    command: CreateCheckoutSessionCommand,
  ): Promise<Result<CheckoutSession>> {
    const configuration = this.configuration();
    if (!configuration.ok) return configuration;

    const authenticated = await this.authenticatedRequest(configuration.value, {
      method: 'POST',
      path: `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders`,
      body: {
        amount: this.minorUnits(command.amount.amount),
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

    void context;
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

  async refund(context: PaymentProviderContext, command: RefundCommand): Promise<Result<Payment>> {
    const configuration = this.configuration();
    if (!configuration.ok) return configuration;
    const response = await this.authenticatedRequest(configuration.value, {
      method: 'POST',
      path: `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders/${encodeURIComponent(command.paymentId)}/refund`,
      body: {
        refundAmount: this.minorUnits(command.amount.amount),
        refundReason: 'Hotel booking refund',
      },
    });
    if (!response.ok) return response;
    const order = response.value.data?.sdkOrder;
    if (!order?.id)
      return this.failure('POKPAY_REFUND_INVALID', 'PokPay did not return a refund order.', true);
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
    const configuration = this.configuration();
    if (!configuration.ok) return null;
    const response = await this.authenticatedRequest(configuration.value, {
      method: 'GET',
      path: `/merchants/${encodeURIComponent(configuration.value.merchantId)}/sdk-orders/${encodeURIComponent(paymentId)}`,
    });
    if (!response.ok) return null;
    const order = response.value.data?.sdkOrder;
    if (!order?.id || order.amount === undefined || !order.currencyCode) return null;
    void context;
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

  private configuration(): Result<PokPayConfiguration> {
    const keyId = process.env.POKPAY_KEY_ID?.trim();
    const keySecret = process.env.POKPAY_KEY_SECRET?.trim();
    const merchantId = process.env.POKPAY_MERCHANT_ID?.trim();
    const webhookUrl = process.env.POKPAY_WEBHOOK_URL?.trim();
    const baseUrl = (
      process.env.POKPAY_API_BASE_URL?.trim() || 'https://api-staging.pokpay.io'
    ).replace(/\/$/, '');
    if (!keyId || !keySecret || !merchantId || !webhookUrl)
      return this.failure(
        'POKPAY_NOT_CONFIGURED',
        'PokPay is not configured for this environment.',
      );
    if (baseUrl !== 'https://api-staging.pokpay.io')
      return this.failure(
        'POKPAY_TEST_MODE_REQUIRED',
        'Only PokPay staging may be used at this stage.',
      );
    try {
      new URL(webhookUrl);
    } catch {
      return this.failure('POKPAY_WEBHOOK_URL_INVALID', 'POKPAY_WEBHOOK_URL must be a valid URL.');
    }
    return { ok: true, value: { baseUrl, keyId, keySecret, merchantId, webhookUrl } };
  }

  private async authenticatedRequest(
    configuration: PokPayConfiguration,
    request: { method: 'GET' | 'POST'; path: string; body?: object },
  ): Promise<Result<PokPayResponse>> {
    try {
      const login = await fetch(`${configuration.baseUrl}/auth/sdk/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId: configuration.keyId, keySecret: configuration.keySecret }),
      });
      const loginBody = (await login.json()) as PokPayResponse;
      const token = loginBody.data?.accessToken;
      if (!login.ok || !token)
        return this.failure('POKPAY_AUTH_FAILED', 'PokPay authentication failed.', true);
      const response = await fetch(`${configuration.baseUrl}${request.path}`, {
        method: request.method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const body = (await response.json()) as PokPayResponse;
      return response.ok
        ? { ok: true, value: body }
        : this.failure(
            'POKPAY_REQUEST_FAILED',
            'PokPay could not process the payment request.',
            response.status >= 500,
          );
    } catch {
      return this.failure(
        'POKPAY_REQUEST_FAILED',
        'PokPay could not process the payment request.',
        true,
      );
    }
  }

  private status(order: PokPayOrder): string {
    if (order.isRefunded) return 'REFUNDED';
    if (order.isCanceled) return 'CANCELLED';
    if (order.isCompleted) return 'COMPLETED';
    return order.status?.toUpperCase() || 'PENDING';
  }

  private minorUnits(amount: string): number {
    const [whole, fraction = ''] = amount.split('.');
    return Number(BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0')));
  }

  private decimalAmount(amount: number | string): string {
    const minor = BigInt(String(amount));
    return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
