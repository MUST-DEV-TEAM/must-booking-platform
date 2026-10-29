'use client';
import { useHotelMoneyScope } from '../../lib/hotel-money-scope';
import { useQuery } from '@tanstack/react-query';

import { Money } from '../../components/ui/money';
import { convertAmount, crossRate, formatMoney, type ApproximateMoney } from '../../lib/money';

type Rates = { base: string; date: string | null; rates: Record<string, number> };

const CODE = /^[A-Za-z]{3}$/;

/**
 * Today's approximate exchange rates for the given currencies, quoted against the hotel's own currency. Only asked
 * for when a screen really has an amount in another currency to show, so most screens never make this request.
 */
export function useTodayRates(tenantId: string, propertyId: string, currencies: string[]) {
  const wanted = Array.from(
    new Set(currencies.filter((code) => CODE.test(code)).map((code) => code.toUpperCase())),
  )
    .sort()
    .slice(0, 30);
  return useQuery({
    queryKey: ['dashboard', 'today-rates', tenantId, propertyId, wanted.join(',')],
    enabled: wanted.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<Rates> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/public/exchange-rates?currencies=${wanted.join(',')}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Exchange rates could not be read.');
      return (await response.json()) as Rates;
    },
  });
}

/** Today's rate as an estimate in `into`, or nothing when no rate is known. */
function estimate(
  rates: Rates | undefined,
  amount: string,
  from: string,
  into: string,
): ApproximateMoney | null {
  if (!rates || Object.keys(rates.rates).length === 0) return null;
  const rate = crossRate(rates.rates, rates.base, from, into);
  return rate === null
    ? null
    : { amount: convertAmount(amount, rate), currency: into, basis: 'estimate', date: rates.date };
}

type LedgerAmountEntry = {
  amount: string;
  currency: string;
  /** Booking-currency units per unit of `currency` on the day the payment was recorded. */
  fxRate?: string | null;
  fxRateDate?: string | null;
};

/**
 * A payment or refund in its own currency. When its currency differs from the booking's, the booking-currency
 * amount follows in brackets: at the rate of the day it was recorded when that is stored, otherwise at today's
 * rate, marked as an estimate.
 */
export function LedgerAmount({
  tenantId,
  propertyId,
  entry,
  bookingCurrency,
  negative = false,
}: {
  tenantId: string;
  propertyId: string;
  entry: LedgerAmountEntry;
  bookingCurrency: string;
  negative?: boolean;
}) {
  const differs = entry.currency.toUpperCase() !== bookingCurrency.toUpperCase();
  const stored = differs && entry.fxRate && Number(entry.fxRate) > 0 ? Number(entry.fxRate) : null;
  const today = useTodayRates(
    tenantId,
    propertyId,
    differs && stored === null ? [entry.currency, bookingCurrency] : [],
  );
  let approximate: ApproximateMoney | null = null;
  if (differs && stored !== null)
    approximate = {
      amount: convertAmount(entry.amount, stored),
      currency: bookingCurrency,
      basis: 'payment-day',
      date: entry.fxRateDate ?? null,
    };
  else if (differs)
    approximate = estimate(today.data, entry.amount, entry.currency, bookingCurrency);
  return (
    <Money
      amount={entry.amount}
      currency={entry.currency}
      approximate={approximate}
      negative={negative}
    />
  );
}

/**
 * An amount in its own currency; when that is not the hotel's own currency, an estimate in the hotel's currency
 * follows in brackets. The hotel's currency and today's rates come from one small, remembered request.
 */
export function HotelMoney({
  tenantId,
  propertyId,
  amount,
  currency,
  negative = false,
}: {
  tenantId: string;
  propertyId: string;
  amount: string;
  currency: string;
  negative?: boolean;
}) {
  const scope = useHotelMoneyScope();
  const hotelCurrency =
    scope?.tenantId === tenantId && scope.propertyId === propertyId ? scope.currency : null;
  const today = useTodayRates(
    tenantId,
    propertyId,
    hotelCurrency?.toUpperCase() === currency.toUpperCase()
      ? []
      : [currency, ...(hotelCurrency ? [hotelCurrency] : [])],
  );
  const base = hotelCurrency ?? today.data?.base;
  const approximate =
    base && currency.toUpperCase() !== base.toUpperCase()
      ? estimate(today.data, amount, currency, base)
      : null;
  return (
    <Money amount={amount} currency={currency} approximate={approximate} negative={negative} />
  );
}

/** An amount that Clock keeps in another currency than the booking, with the booking-currency estimate beside it. */
export function ConvertedMoney({
  tenantId,
  propertyId,
  amount,
  currency,
  into,
}: {
  tenantId: string;
  propertyId: string;
  amount: string;
  currency: string;
  into: string;
}) {
  const differs = currency.toUpperCase() !== into.toUpperCase();
  const today = useTodayRates(tenantId, propertyId, differs ? [currency, into] : []);
  return (
    <Money
      amount={amount}
      currency={currency}
      approximate={differs ? estimate(today.data, amount, currency, into) : null}
    />
  );
}

/**
 * Totals kept per currency, for example a guest's spending. Each currency stays on its own: amounts in different
 * currencies are never added. A currency other than the hotel's gets an estimate in the hotel's currency beside it.
 */
export function MoneyList({
  tenantId,
  propertyId,
  list,
}: {
  tenantId: string;
  propertyId: string;
  list: Array<{ currency: string; amount: string }>;
}) {
  const scope = useHotelMoneyScope();
  const hotelCurrency =
    scope?.tenantId === tenantId && scope.propertyId === propertyId ? scope.currency : null;
  const foreign = list
    .map((item) => item.currency)
    .filter((currency) => currency.toUpperCase() !== hotelCurrency?.toUpperCase());
  const today = useTodayRates(
    tenantId,
    propertyId,
    foreign.length ? [...foreign, ...(hotelCurrency ? [hotelCurrency] : [])] : [],
  );
  if (list.length === 0) return <>—</>;
  const base = hotelCurrency ?? today.data?.base;
  return (
    <>
      {list.map((item, index) => (
        <span key={item.currency}>
          {index > 0 ? ' · ' : ''}
          {base && item.currency.toUpperCase() !== base.toUpperCase() ? (
            <Money
              amount={item.amount}
              currency={item.currency}
              approximate={estimate(today.data, item.amount, item.currency, base)}
            />
          ) : (
            formatMoney(item.amount, item.currency)
          )}
        </span>
      ))}
    </>
  );
}

/** Shared UI uses the selected hotel scope; outside it, only the real amount is shown. */
export function ScopedHotelMoney(props: { amount: string; currency: string; negative?: boolean }) {
  const scope = useHotelMoneyScope();
  return scope ? (
    <HotelMoney tenantId={scope.tenantId} propertyId={scope.propertyId} {...props} />
  ) : (
    <Money {...props} />
  );
}
