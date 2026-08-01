import { Inject, Injectable } from '@nestjs/common';
import { BookingPaymentMethod, type PaymentProvider } from '@must/domain-contracts';

import { PokPayPaymentProvider } from './pokpay-payment.provider';
import { PAYMENT_PROVIDER } from './payment.provider';

@Injectable()
export class PaymentProviderRegistry {
  constructor(
    @Inject(PAYMENT_PROVIDER) readonly stripe: PaymentProvider,
    public pokpay: PokPayPaymentProvider,
  ) {}

  forBookingMethod(method: BookingPaymentMethod): PaymentProvider | null {
    if (method === BookingPaymentMethod.STRIPE_CHECKOUT) return this.stripe;
    if (method === BookingPaymentMethod.POKPAY) return this.pokpay;
    return null;
  }

  forProvider(provider: string): PaymentProvider | null {
    if (provider === 'stripe') return this.stripe;
    if (provider === 'pokpay') return this.pokpay;
    return null;
  }
}
