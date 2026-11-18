'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ChecklistPanel, type ChecklistItem } from '../../components/ui/checklist-panel';
import { DetailList } from '../../components/ui/detail-list';
import { SearchInput } from '../../components/ui/search-input';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import type {
  Property,
  ReadinessStep,
  SettingsAttentionItem,
  SettingsOverviewHidden,
  SettingsSummary,
} from './settings-areas';
import { settingsTab, settingsTabHref, type SettingsTab } from './settings-registry';
import { findSettings } from './settings-search';
import { settingsSummaryKey as summaryKey, useSettingsSummary } from './settings-summary';

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
      status: status('contact'),
      items: [
        { label: 'Guest contact email', value: property.supportEmail },
        { label: 'Phone', value: property.phone },
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
    {
      tab: 'emails',
      status: status('email'),
      items: [
        {
          label: 'Guest emails are sent from',
          value:
            status('email') === 'done'
              ? 'Your own email provider'
              : status('email')
                ? "MUST's address"
                : null,
        },
      ],
    },
  ];
}

const glanceBadge = {
  done: { variant: 'success', label: 'Ready' },
  attention: { variant: 'warning', label: 'Needs attention' },
  todo: { variant: 'secondary', label: 'Not set' },
} as const;

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
  const query = useSettingsSummary(tenantId, propertyId);
  const queryClient = useQueryClient();
  const hide = useMutation({
    mutationFn: async (change: Partial<SettingsOverviewHidden>) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/settings-summary/hidden`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(change),
        },
      );
      if (!response.ok) throw new Error('Unable to save this choice.');
      return (await response.json()) as SettingsOverviewHidden;
    },
    // Show the choice at once; the server answer (or a reload after a failure) settles it.
    onMutate: (change) =>
      queryClient.setQueryData<SettingsSummary>(summaryKey(tenantId, propertyId), (old) =>
        old ? { ...old, hidden: { ...old.hidden, ...change } } : old,
      ),
    onSuccess: (hidden) =>
      queryClient.setQueryData<SettingsSummary>(summaryKey(tenantId, propertyId), (old) =>
        old ? { ...old, hidden } : old,
      ),
    onError: () => void query.refetch(),
  });
  // "Ready to take bookings" shows once: it is marked as seen the first time it is shown, and stays on
  // screen for this visit.
  const [readyShownNow, setReadyShownNow] = useState(false);
  const readyFirstTime = query.data?.ready === true && query.data.hidden?.readyNotice === false;
  useEffect(() => {
    if (!readyFirstTime) return;
    setReadyShownNow(true);
    hide.mutate({ readyNotice: true });
  }, [readyFirstTime]);
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
  const hidden = query.data.hidden ?? { setupGuide: false, readyNotice: false };
  const done = steps.filter((step) => step.status === 'done').length;
  const link = (tab: SettingsTab) => settingsTabHref(tenantId, propertyId, tab);
  const attentionLink = (target: SettingsAttentionItem['link']) =>
    'tab' in target
      ? link(target.tab)
      : `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${target.section}&${target.extra}`;
  const attention = [
    ...steps
      .filter((step) => step.status === 'attention')
      .map((step) => ({
        key: step.key,
        label: step.label,
        note: step.note,
        href: link(step.tab),
        action: 'Fix',
      })),
    ...(query.data.attention ?? []).map((item) => ({
      key: item.key,
      label: item.label,
      note: item.note,
      href: attentionLink(item.link),
      action: 'View',
    })),
  ];
  const guide: ChecklistItem[] = steps.map((step) => ({
    key: step.key,
    label: step.optional ? `${step.label} (recommended)` : step.label,
    detail: step.note,
    status: step.status,
    href: link(step.tab),
  }));
  const matches = findSettings(search);

  return (
    <div className="flex flex-col gap-5">
      {!ready ? (
        hidden.setupGuide ? (
          <div>
            <Button variant="link" size="sm" onClick={() => hide.mutate({ setupGuide: false })}>
              Setup: {done} of {steps.length} done · Show
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ChecklistPanel
              title="Set up your hotel"
              description="Finish these and guests can book and pay online."
              items={guide}
            />
            <div>
              <Button variant="ghost" size="sm" onClick={() => hide.mutate({ setupGuide: true })}>
                Hide for now
              </Button>
            </div>
          </div>
        )
      ) : readyShownNow ? (
        <Alert variant="success">
          <AlertTitle>Your hotel is ready to take bookings</AlertTitle>
          <AlertDescription>Setup is complete. This message shows once.</AlertDescription>
        </Alert>
      ) : null}

      {attention.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              Needs attention <Badge variant="warning">{attention.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {attention.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-warning"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.note}</span>
                    </span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={item.href}>{item.action}</a>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Settings at a glance" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h4 className="m-0 text-base font-semibold">Settings at a glance</h4>
          <p className="m-0 text-sm text-muted-foreground">
            Read-only summary. Edit opens the tab.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {settingsGlance(property, steps).map((card) => (
            <Card key={card.tab}>
              <CardHeader>
                <CardTitle className="text-base">
                  {settingsTab(card.tab).label}{' '}
                  {card.status ? (
                    <Badge variant={glanceBadge[card.status].variant}>
                      {glanceBadge[card.status].label}
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
