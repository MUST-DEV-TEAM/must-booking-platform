'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ChecklistPanel, type ChecklistItem } from '../../components/ui/checklist-panel';
import { DetailList } from '../../components/ui/detail-list';
import { SearchInput } from '../../components/ui/search-input';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import type { Property, ReadinessStep, SettingsReadiness } from './settings-areas';
import { settingsTab, settingsTabHref, type SettingsTab } from './settings-registry';
import { findSettings } from './settings-search';

const bookingModes = {
  ROOM_TYPE_ONLY: 'Room types',
  INDIVIDUAL_ROOM_ONLY: 'Individual rooms',
  MIXED: 'Rooms and room types',
} as const;

const stay = (min: number | null, max: number | null) =>
  min === null && max === null
    ? 'No limits'
    : `${min ?? 1} to ${max === null ? 'any number of' : max} nights`;

type GlanceCard = {
  tab: SettingsTab;
  status?: ReadinessStep['status'];
  items: Array<{ label: string; value: string | null }>;
};

/** The key values of each tab, read-only, for "Settings at a glance". */
export function settingsGlance(property: Property, steps: readonly ReadinessStep[]): GlanceCard[] {
  const status = (key: ReadinessStep['key']) => steps.find((step) => step.key === key)?.status;
  const gateways = property.paymentGateways;
  const methods = [
    gateways.payAtHotel ? 'Pay at hotel' : null,
    gateways.stripe ? 'Stripe' : null,
    gateways.pokpay ? 'PokPay' : null,
  ].filter(Boolean);
  return [
    {
      tab: 'profile',
      status: status('profile'),
      items: [
        { label: 'Name', value: property.name },
        { label: 'Address', value: property.address },
        { label: 'Time zone', value: property.timezone },
        { label: 'Currency', value: property.defaultCurrency ?? null },
      ],
    },
    {
      tab: 'contact-brand',
      items: [
        { label: 'Phone', value: property.phone },
        { label: 'Support email', value: property.supportEmail },
        { label: 'Website', value: property.website ?? null },
      ],
    },
    {
      tab: 'booking-rules',
      status: status('booking-rules'),
      items: [
        { label: 'Inventory mode', value: bookingModes[property.bookingMode] },
        { label: 'Stay', value: stay(property.minStayNights, property.maxStayNights) },
        {
          label: 'Booking window',
          value:
            property.advanceBookingDays === null
              ? 'No limit'
              : `${property.advanceBookingDays} days ahead`,
        },
      ],
    },
    {
      tab: 'policies',
      status: status('policies'),
      items: [
        { label: 'Check-in', value: property.checkInTime },
        { label: 'Check-out', value: property.checkOutTime },
        {
          label: 'Free cancellation',
          value: `${property.freeCancellationDaysBeforeArrival} days before arrival`,
        },
      ],
    },
    {
      tab: 'payment-methods',
      status: status('payment-methods'),
      items: [{ label: 'Guests can pay with', value: methods.join(', ') || 'Nothing yet' }],
    },
    {
      tab: 'integrations',
      status: status('website'),
      items: [
        {
          label: 'Hotel website',
          value: property.wordpressConnectedAt ? 'Connected' : 'Not connected yet',
        },
      ],
    },
  ];
}

const hiddenKey = (propertyId: string) => `must.settings.setup-hidden.${propertyId}`;
const celebratedKey = (propertyId: string) => `must.settings.setup-celebrated.${propertyId}`;
function remembered(key: string) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function remember(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    /* the choice is just not remembered */
  }
}

/**
 * The Settings overview: a setup guide while setup is unfinished, what needs attention, every tab
 * at a glance and a search for a setting (settings redesign plan, S1).
 */
export function SettingsOverview({
  tenantId,
  propertyId,
  canWrite,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
}) {
  const query = useQuery({
    queryKey: ['dashboard', 'settings-summary', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/settings-summary`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Unable to load the hotel settings.');
      return (await response.json()) as SettingsReadiness & { hotel: Property };
    },
  });
  const [hidden, setHidden] = useState(() => remembered(hiddenKey(propertyId)));
  const [celebrated, setCelebrated] = useState(() => remembered(celebratedKey(propertyId)));
  const [search, setSearch] = useState('');

  if (query.isPending) return <ListSkeleton rows={4} />;
  if (query.isError)
    return (
      <ErrorPanel
        title="Settings are unavailable"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );

  const { steps, ready, hotel: property } = query.data;
  const done = steps.filter((step) => step.status === 'done').length;
  const link = (tab: SettingsTab) => settingsTabHref(tenantId, propertyId, tab);
  const attention = steps.filter((step) => step.status === 'attention');
  const guide: ChecklistItem[] = steps.map((step) => ({
    key: step.key,
    label: step.label,
    detail: step.note,
    status: step.status,
    href: link(step.tab),
  }));
  const matches = findSettings(search);

  return (
    <div className="flex flex-col gap-5">
      {!ready ? (
        hidden ? (
          <div>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                remember(hiddenKey(propertyId), false);
                setHidden(false);
              }}
            >
              Setup: {done} of {steps.length}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ChecklistPanel
              title="Set up your hotel"
              description="Finish these steps and guests can book."
              items={guide}
            />
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  remember(hiddenKey(propertyId), true);
                  setHidden(true);
                }}
              >
                Hide for now
              </Button>
            </div>
          </div>
        )
      ) : !celebrated ? (
        <Alert variant="success">
          <AlertTitle>Your hotel is ready to take bookings</AlertTitle>
          <AlertDescription>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                remember(celebratedKey(propertyId), true);
                setCelebrated(true);
              }}
            >
              Got it
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {attention.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {attention.map((step) => (
                <li
                  key={step.key}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">{step.label}</span>
                    <span className="text-xs text-muted-foreground">{step.note}</span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={link(step.tab)}>Fix</a>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Settings at a glance" className="flex flex-col gap-3">
        <h4 className="m-0 text-base font-semibold">Settings at a glance</h4>
        <div className="grid gap-3 md:grid-cols-2">
          {settingsGlance(property, steps).map((card) => (
            <Card key={card.tab}>
              <CardHeader>
                <CardTitle className="text-base">
                  {settingsTab(card.tab).label}{' '}
                  {card.status ? (
                    <Badge variant={card.status === 'done' ? 'success' : 'warning'}>
                      {card.status === 'done' ? 'Ready' : 'Needs attention'}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardAction>
                  <Button asChild size="sm" variant="outline">
                    <a href={link(card.tab)}>{canWrite ? 'Edit' : 'View'}</a>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <DetailList items={card.items} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Find a setting" className="flex flex-col gap-2">
        <h4 className="m-0 text-base font-semibold">Find a setting</h4>
        <SearchInput
          aria-label="Find a setting"
          placeholder="Try check-in, currency or tax number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search.trim() ? (
          matches.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {matches.map((entry) => (
                <li key={entry.label}>
                  <a
                    href={link(entry.tab)}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-inherit no-underline hover:bg-accent"
                  >
                    <span>{entry.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {settingsTab(entry.tab).label}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No setting matches that.</p>
          )
        ) : null}
      </section>
    </div>
  );
}
