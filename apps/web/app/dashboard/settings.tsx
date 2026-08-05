'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { PropertyManagement } from './[tenantId]/property-management';

type PaymentGateways = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
type Property = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  minStayNights: number | null;
  maxStayNights: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  advanceBookingDays: number | null;
  freeCancellationDaysBeforeArrival: number;
  bookingMode: BookingMode;
  paymentGateways: PaymentGateways;
};

type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';

type PlanUsage = { plan: { name: string } };

type IdentityFields = Pick<Property, 'name' | 'address' | 'timezone'>;
type RuleFields = Pick<
  Property,
  | 'minStayNights'
  | 'maxStayNights'
  | 'checkInTime'
  | 'checkOutTime'
  | 'advanceBookingDays'
  | 'freeCancellationDaysBeforeArrival'
>;

const ruleKeys = [
  'minStayNights',
  'maxStayNights',
  'checkInTime',
  'checkOutTime',
  'advanceBookingDays',
  'freeCancellationDaysBeforeArrival',
] as const;

function rulesFrom(property: Property): RuleFields {
  return {
    minStayNights: property.minStayNights,
    maxStayNights: property.maxStayNights,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    advanceBookingDays: property.advanceBookingDays,
    freeCancellationDaysBeforeArrival: property.freeCancellationDaysBeforeArrival,
  };
}

export function DashboardSettings({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [identity, setIdentity] = useState<IdentityFields | null>(null);
  const [rules, setRules] = useState<RuleFields | null>(null);
  const [bookingMode, setBookingMode] = useState<BookingMode | null>(null);
  const [paymentGateways, setPaymentGateways] = useState<PaymentGateways | null>(null);
  const base = `/api/tenants/${tenantId}`;
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['dashboard', 'settings', tenantId, propertyId],
    queryFn: async () => {
      const [propertiesResponse, planResponse] = await Promise.all([
        fetch(`${base}/properties`, { credentials: 'include' }),
        fetch(`${base}/plan-usage`, { credentials: 'include' }),
      ]);
      if (!propertiesResponse.ok) throw new Error('Unable to load property settings.');
      const properties = (await propertiesResponse.json()) as Property[];
      const property = properties.find((item) => item.id === propertyId);
      if (!property) throw new Error('Property settings were not found.');
      return {
        property,
        planName: planResponse.ok ? ((await planResponse.json()) as PlanUsage).plan.name : null,
      };
    },
  });
  const property = settingsQuery.data?.property ?? null;
  const planName = settingsQuery.data?.planName ?? null;

  useEffect(() => {
    if (!property) return;
    setIdentity({ name: property.name, address: property.address, timezone: property.timezone });
    setRules(rulesFrom(property));
    setBookingMode(property.bookingMode);
    setPaymentGateways(property.paymentGateways);
  }, [property]);

  const saveMutation = useMutation({
    mutationFn: async (update: Partial<Property>) => {
      const response = await fetch(`${base}/properties/${propertyId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error('Unable to save settings.');
      return (await response.json()) as Property;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ property: Property; planName: string | null }>(
        ['dashboard', 'settings', tenantId, propertyId],
        (current) => ({ property: updated, planName: current?.planName ?? null }),
      );
      toast.success('Settings saved.');
    },
    onError: () => toast.error('Unable to save settings.'),
  });

  async function save(update: Partial<Property>) {
    if (!property || Object.keys(update).length === 0) return;
    saveMutation.mutate(update);
  }

  const paymentGatewaysMutation = useMutation({
    mutationFn: async (update: PaymentGateways) => {
      const response = await fetch(`${base}/properties/${propertyId}/payment-gateways`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error('Unable to save payment methods.');
      return update;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ property: Property; planName: string | null }>(
        ['dashboard', 'settings', tenantId, propertyId],
        (current) =>
          current
            ? { ...current, property: { ...current.property, paymentGateways: updated } }
            : current,
      );
      toast.success('Payment methods saved.');
    },
    onError: () => toast.error('Unable to save payment methods.'),
  });

  function savePaymentGateways(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentGateways) return;
    paymentGatewaysMutation.mutate(paymentGateways);
  }

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!property || !identity) return;
    const update = (Object.keys(identity) as Array<keyof IdentityFields>).reduce<Partial<Property>>(
      (result, key) =>
        identity[key] === property[key] ? result : { ...result, [key]: identity[key] },
      {},
    );
    void save(update);
  }

  function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!property || !rules) return;
    const update = ruleKeys.reduce<Partial<Property>>(
      (result, key) => (rules[key] === property[key] ? result : { ...result, [key]: rules[key] }),
      {},
    );
    void save(update);
  }

  function saveBookingMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!property || !bookingMode || bookingMode === property.bookingMode) return;
    void save({ bookingMode });
  }

  const numberRule = (key: 'minStayNights' | 'maxStayNights' | 'advanceBookingDays') =>
    rules?.[key] === null || rules?.[key] === undefined ? '' : String(rules[key]);

  if (settingsQuery.isPending)
    return (
      <section aria-label="Loading settings">
        <Text>Loading settings…</Text>
      </section>
    );
  if (settingsQuery.isError)
    return (
      <Card>
        <Text>{settingsQuery.error.message}</Text>
        <button className="must-button" type="button" onClick={() => void settingsQuery.refetch()}>
          Retry
        </button>
      </Card>
    );
  if (!property || !identity || !rules || !bookingMode || !paymentGateways)
    return (
      <section aria-label="Loading settings">
        <Text>Loading settings…</Text>
      </section>
    );

  return (
    <Stack gap="lg">
      <Heading level={1}>Settings</Heading>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Hotel identity</Heading>
          <form className="must-stack must-stack--md" onSubmit={saveIdentity}>
            <label className="must-field">
              <span className="must-field__label">Hotel name</span>
              <input
                className="must-input"
                aria-label="Hotel name"
                required
                value={identity.name}
                onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">Address</span>
              <input
                className="must-input"
                aria-label="Address"
                required
                value={identity.address}
                onChange={(event) => setIdentity({ ...identity, address: event.target.value })}
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">Timezone</span>
              <input
                className="must-input"
                aria-label="Timezone"
                required
                value={identity.timezone}
                onChange={(event) => setIdentity({ ...identity, timezone: event.target.value })}
              />
            </label>
            <button className="must-button must-button--primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save hotel identity'
              )}
            </button>
          </form>
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Booking rules</Heading>
          <Text tone="secondary">
            These rules are enforced when guests request a quote or booking.
          </Text>
          <form className="must-stack must-stack--md" onSubmit={saveRules}>
            <label className="must-field">
              <span className="must-field__label">Minimum stay (nights)</span>
              <input
                className="must-input"
                aria-label="Minimum stay (nights)"
                type="number"
                min="1"
                value={numberRule('minStayNights')}
                onChange={(event) =>
                  setRules({
                    ...rules,
                    minStayNights: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">Maximum stay (nights)</span>
              <input
                className="must-input"
                aria-label="Maximum stay (nights)"
                type="number"
                min="1"
                value={numberRule('maxStayNights')}
                onChange={(event) =>
                  setRules({
                    ...rules,
                    maxStayNights: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">Advance booking window (days)</span>
              <input
                className="must-input"
                aria-label="Advance booking window (days)"
                type="number"
                min="0"
                value={numberRule('advanceBookingDays')}
                onChange={(event) =>
                  setRules({
                    ...rules,
                    advanceBookingDays:
                      event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">
                Free cancellation window (days before arrival)
              </span>
              <input
                className="must-input"
                aria-label="Free cancellation window (days before arrival)"
                type="number"
                min="0"
                value={String(rules.freeCancellationDaysBeforeArrival)}
                onChange={(event) =>
                  setRules({
                    ...rules,
                    freeCancellationDaysBeforeArrival:
                      event.target.value === '' ? 0 : Number(event.target.value),
                  })
                }
              />
            </label>
            <Text tone="secondary">
              Cancellations requested at least this many days before arrival are refunded
              automatically. Closer to arrival, the guest is directed to contact the hotel and staff
              handle the cancellation manually.
            </Text>
            <Text tone="secondary">
              Check-in and check-out times are displayed to guests. They do not validate or block
              bookings.
            </Text>
            <label className="must-field">
              <span className="must-field__label">Check-in time</span>
              <input
                className="must-input"
                aria-label="Check-in time"
                value={rules.checkInTime ?? ''}
                onChange={(event) =>
                  setRules({ ...rules, checkInTime: event.target.value || null })
                }
              />
            </label>
            <label className="must-field">
              <span className="must-field__label">Check-out time</span>
              <input
                className="must-input"
                aria-label="Check-out time"
                value={rules.checkOutTime ?? ''}
                onChange={(event) =>
                  setRules({ ...rules, checkOutTime: event.target.value || null })
                }
              />
            </label>
            <button className="must-button must-button--primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save booking rules'
              )}
            </button>
          </form>
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Booking mode</Heading>
          <Text tone="secondary">
            Choose whether guests book a room type, a specific room, or either option.
          </Text>
          <form className="must-stack must-stack--md" onSubmit={saveBookingMode}>
            <label className="must-field">
              <span className="must-field__label">Booking mode</span>
              <select
                className="must-input"
                aria-label="Booking mode"
                value={bookingMode}
                onChange={(event) => setBookingMode(event.target.value as BookingMode)}
              >
                <option value="ROOM_TYPE_ONLY">Room-Type-Only</option>
                <option value="INDIVIDUAL_ROOM_ONLY">Individual-Room-Only</option>
                <option value="MIXED">Mixed</option>
              </select>
            </label>
            <button className="must-button must-button--primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save booking mode'
              )}
            </button>
          </form>
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Payment methods</Heading>
          <Text tone="secondary">
            Choose which payment methods guests and staff can use for bookings at this property.
            Stripe and PokPay also need a working connection under Integrations.
          </Text>
          <form className="must-stack must-stack--md" onSubmit={savePaymentGateways}>
            <label className="must-field">
              <input
                type="checkbox"
                checked={paymentGateways.payAtHotel}
                onChange={(event) =>
                  setPaymentGateways({ ...paymentGateways, payAtHotel: event.target.checked })
                }
              />
              <span className="must-field__label">Pay at hotel</span>
            </label>
            <label className="must-field">
              <input
                type="checkbox"
                checked={paymentGateways.stripe}
                onChange={(event) =>
                  setPaymentGateways({ ...paymentGateways, stripe: event.target.checked })
                }
              />
              <span className="must-field__label">Stripe</span>
            </label>
            <label className="must-field">
              <input
                type="checkbox"
                checked={paymentGateways.pokpay}
                onChange={(event) =>
                  setPaymentGateways({ ...paymentGateways, pokpay: event.target.checked })
                }
              />
              <span className="must-field__label">PokPay</span>
            </label>
            <button
              className="must-button must-button--primary"
              disabled={paymentGatewaysMutation.isPending}
            >
              {paymentGatewaysMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save payment methods'
              )}
            </button>
          </form>
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Billing account</Heading>
          <Text tone="secondary">Current plan: {planName ?? 'Loading…'}</Text>
          <button
            className="must-button must-button--secondary"
            disabled
            title="Billing management arrives in Milestone 13"
          >
            Billing management available in Milestone 13
          </button>
        </Stack>
      </Card>

      <Card>
        <Stack gap="md">
          <Heading level={2}>Manage properties</Heading>
          <PropertyManagement tenantId={tenantId} />
        </Stack>
      </Card>
    </Stack>
  );
}
