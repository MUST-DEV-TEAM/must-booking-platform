'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { PropertyManagement } from './[tenantId]/property-management';

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
        <p>Loading settings…</p>
      </section>
    );
  if (settingsQuery.isError)
    return (
      <section aria-label="Settings unavailable">
        <p>{settingsQuery.error.message}</p>
        <button className="must-button" type="button" onClick={() => void settingsQuery.refetch()}>
          Retry
        </button>
      </section>
    );
  if (!property || !identity || !rules || !bookingMode)
    return (
      <section aria-label="Loading settings">
        <p>Loading settings…</p>
      </section>
    );

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>

      <section aria-labelledby="hotel-identity-heading">
        <h2 id="hotel-identity-heading">Hotel identity</h2>
        {identity ? (
          <form onSubmit={saveIdentity}>
            <label>
              Hotel name
              <input
                aria-label="Hotel name"
                required
                value={identity.name}
                onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              />
            </label>
            <label>
              Address
              <input
                aria-label="Address"
                required
                value={identity.address}
                onChange={(event) => setIdentity({ ...identity, address: event.target.value })}
              />
            </label>
            <label>
              Timezone
              <input
                aria-label="Timezone"
                required
                value={identity.timezone}
                onChange={(event) => setIdentity({ ...identity, timezone: event.target.value })}
              />
            </label>
            <button disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save hotel identity'
              )}
            </button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="booking-rules-heading">
        <h2 id="booking-rules-heading">Booking rules</h2>
        <p>These rules are enforced when guests request a quote or booking.</p>
        {rules ? (
          <form onSubmit={saveRules}>
            <label>
              Minimum stay (nights)
              <input
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
            <label>
              Maximum stay (nights)
              <input
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
            <label>
              Advance booking window (days)
              <input
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
            <label>
              Free cancellation window (days before arrival)
              <input
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
            <p>
              Cancellations requested at least this many days before arrival are refunded
              automatically. Closer to arrival, the guest is directed to contact the hotel and staff
              handle the cancellation manually.
            </p>
            <p>
              Check-in and check-out times are displayed to guests. They do not validate or block
              bookings.
            </p>
            <label>
              Check-in time
              <input
                aria-label="Check-in time"
                value={rules.checkInTime ?? ''}
                onChange={(event) =>
                  setRules({ ...rules, checkInTime: event.target.value || null })
                }
              />
            </label>
            <label>
              Check-out time
              <input
                aria-label="Check-out time"
                value={rules.checkOutTime ?? ''}
                onChange={(event) =>
                  setRules({ ...rules, checkOutTime: event.target.value || null })
                }
              />
            </label>
            <button disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Saving…
                </>
              ) : (
                'Save booking rules'
              )}
            </button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="booking-mode-heading">
        <h2 id="booking-mode-heading">Booking mode</h2>
        <p>Choose whether guests book a room type, a specific room, or either option.</p>
        <form onSubmit={saveBookingMode}>
          <label>
            Booking mode
            <select
              aria-label="Booking mode"
              value={bookingMode}
              onChange={(event) => setBookingMode(event.target.value as BookingMode)}
            >
              <option value="ROOM_TYPE_ONLY">Room-Type-Only</option>
              <option value="INDIVIDUAL_ROOM_ONLY">Individual-Room-Only</option>
              <option value="MIXED">Mixed</option>
            </select>
          </label>
          <button disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 aria-hidden="true" size={16} /> Saving…
              </>
            ) : (
              'Save booking mode'
            )}
          </button>
        </form>
      </section>

      <section aria-labelledby="billing-account-heading">
        <h2 id="billing-account-heading">Billing account</h2>
        <p>Current plan: {planName ?? 'Loading…'}</p>
        <button disabled title="Billing management arrives in Milestone 13">
          Billing management available in Milestone 13
        </button>
      </section>

      <section aria-labelledby="manage-properties-heading">
        <h2 id="manage-properties-heading">Manage properties</h2>
        <PropertyManagement tenantId={tenantId} />
      </section>
    </section>
  );
}
