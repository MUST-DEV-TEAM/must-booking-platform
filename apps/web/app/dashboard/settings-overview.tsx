'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { SetupGuide, type SetupGuideStep } from '../../components/ui/setup-guide';
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

type GlanceTone = 'success' | 'warning' | 'secondary';
type GlanceCard = {
  tab: SettingsTab;
  /** The pill at the top right of the card. */
  badge: { label: string; tone: GlanceTone };
  items: Array<{ label: string; value: string | null }>;
};

const noShowWords: Record<string, string> = {
  charge_first_night: 'First night charged',
  charge_nothing: 'Nothing charged',
  flag_for_review: 'Flagged for review',
};
const propertyTypeWords: Record<string, string> = {
  hotel: 'Hotel',
  resort: 'Resort',
  boutique_hotel: 'Boutique hotel',
  apartment_hotel: 'Apartment hotel',
  apartments: 'Apartments',
  guesthouse: 'Guesthouse / B&B',
  hostel: 'Hostel',
  villa: 'Villa',
  motel: 'Motel',
  campsite: 'Campsite / Glamping',
};
const onOff = (on: boolean | undefined) => (on ? 'On' : 'Off');

/**
 * The key values of each tab, read-only, for "Settings at a glance". A value that is not known yet
 * (a setting whose page is not built) shows as null, which the card draws as a dash.
 */
export function settingsGlance(
  property: Property,
  steps: readonly ReadinessStep[],
  attention: readonly SettingsAttentionItem[] = [],
): GlanceCard[] {
  const status = (key: ReadinessStep['key']) => steps.find((step) => step.key === key)?.status;
  const ready = (key: ReadinessStep['key']): GlanceCard['badge'] =>
    status(key) === 'done'
      ? { label: 'Complete', tone: 'success' }
      : status(key) === 'attention'
        ? { label: 'Needs attention', tone: 'warning' }
        : { label: 'Not set', tone: 'secondary' };
  const flagged = (prefix: string) => attention.filter((item) => item.key.startsWith(prefix));
  const gateways = property.paymentGateways;
  const connected = new Set(property.connectedProviders ?? []);
  const testMode = flagged('payments-test').length > 0;
  const failedEmails = attention.find((item) => item.key === 'email-failed');
  const pms = property.pmsSource === 'CLOCK_PMS';
  const place = [property.city, property.country ? regionName(property.country) : null]
    .filter(Boolean)
    .join(', ');
  const live = connected.size + (property.wordpressConnectedAt ? 1 : 0);
  return [
    {
      tab: 'profile',
      badge: ready('profile'),
      items: [
        {
          label: 'Hotel',
          value: property.starRating ? `${property.name} · ${property.starRating}★` : property.name,
        },
        {
          label: 'Type',
          value: property.propertyType
            ? (propertyTypeWords[property.propertyType] ?? property.propertyType)
            : null,
        },
        { label: 'Location', value: place || property.address },
        { label: 'Currency', value: property.defaultCurrency ?? null },
      ],
    },
    {
      tab: 'contact-brand',
      badge: ready('contact'),
      items: [
        { label: 'Guest email', value: property.supportEmail },
        { label: 'Phone', value: property.phone },
        {
          label: 'Brand',
          value:
            [property.logoUrl ? 'Logo' : null, property.brandColour ?? null]
              .filter(Boolean)
              .join(' and ') || null,
        },
      ],
    },
    {
      tab: 'booking-rules',
      badge: ready('booking-rules'),
      items: [
        { label: 'Stay', value: stay(property.minStayNights, property.maxStayNights) },
        {
          label: 'Book ahead',
          value:
            property.advanceBookingDays === null
              ? 'No limit'
              : `up to ${property.advanceBookingDays} days`,
        },
        {
          label: 'Same day',
          value:
            property.allowSameDayBooking === false
              ? 'Not allowed'
              : property.sameDayCutoffTime
                ? `until ${property.sameDayCutoffTime}`
                : 'Allowed',
        },
        { label: 'Guests choose', value: bookingModes[property.bookingMode].toLowerCase() },
      ],
    },
    {
      tab: 'policies',
      badge: ready('policies'),
      items: [
        {
          label: 'Check-in / out',
          value:
            property.checkInTime && property.checkOutTime
              ? `${property.checkInTime} / ${property.checkOutTime}`
              : null,
        },
        {
          label: 'Free cancellation',
          value: `${property.freeCancellationDaysBeforeArrival} days before arrival`,
        },
        { label: 'Automatic refund', value: onOff(property.autoRefundOnFreeCancellation) },
        { label: 'No-show', value: noShowWords[property.noShowRule ?? ''] ?? null },
      ],
    },
    {
      tab: 'taxes-fees',
      badge: { label: 'Not set', tone: 'secondary' },
      items: [
        { label: 'VAT', value: property.vatRegistered ? 'Registered' : null },
        { label: 'City tax', value: null },
      ],
    },
    {
      tab: 'payment-methods',
      badge: testMode
        ? { label: 'Test mode', tone: 'warning' }
        : status('payment-methods') === 'done'
          ? { label: 'Live', tone: 'success' }
          : ready('payment-methods'),
      items: [
        { label: 'Pay at hotel', value: onOff(gateways.payAtHotel) },
        { label: 'Card (Stripe)', value: gateways.stripe ? (testMode ? 'Test' : 'On') : 'Off' },
        { label: 'PokPay', value: onOff(gateways.pokpay) },
        {
          label: 'Payment hold',
          value:
            property.onlinePaymentHoldMinutes === undefined
              ? null
              : `${property.onlinePaymentHoldMinutes} minutes`,
        },
      ],
    },
    {
      tab: 'integrations',
      badge: live ? { label: `${live} active`, tone: 'success' } : ready('website'),
      items: [
        { label: 'Property system', value: pms ? 'Connected' : 'MUST' },
        { label: 'Stripe', value: connected.has('STRIPE') ? 'Connected' : 'Off' },
        { label: 'Website', value: property.wordpressConnectedAt ? 'Connected' : 'Not connected' },
        { label: 'PokPay', value: connected.has('POKPAY') ? 'Connected' : 'Off' },
      ],
    },
    {
      tab: 'emails',
      badge: failedEmails
        ? { label: 'Needs attention', tone: 'warning' }
        : status('email') === 'done'
          ? { label: 'Own provider', tone: 'success' }
          : { label: 'MUST address', tone: 'secondary' },
      items: [
        {
          label: 'Sender',
          value: status('email') === 'done' ? 'Your own provider' : "MUST's address",
        },
        { label: 'Reservations email', value: property.reservationsEmail ?? null },
        {
          label: 'Last 7 days',
          value: failedEmails ? failedEmails.label.split(' not')[0] + ' failed' : 'No problems',
        },
      ],
    },
    {
      tab: 'team',
      badge:
        property.staffCount === undefined
          ? { label: 'Team', tone: 'secondary' }
          : { label: `${property.staffCount} staff`, tone: 'secondary' },
      items: [
        {
          label: 'Staff',
          value: property.staffCount === undefined ? null : `${property.staffCount} active`,
        },
        { label: 'Roles', value: null },
        { label: 'Extra permissions', value: null },
      ],
    },
    {
      tab: 'plan-usage',
      badge: { label: 'Plan', tone: 'secondary' },
      items: [
        { label: 'Staff accounts', value: null },
        {
          label: 'Rooms',
          value: property.roomCount === undefined ? null : String(property.roomCount),
        },
      ],
    },
    {
      tab: 'audit-log',
      badge: { label: 'History', tone: 'secondary' },
      items: [
        { label: 'Last change', value: null },
        { label: 'By', value: null },
        { label: 'When', value: null },
      ],
    },
  ];
}

function regionName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
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
  const guide: SetupGuideStep[] = steps.map((step) => ({
    key: step.key,
    label: step.optional ? `${step.label} (recommended)` : step.label,
    detail: step.note,
    done: step.status === 'done',
    href: link(step.tab),
    action: step.status === 'attention' ? 'Fix' : 'Set up',
  }));
  const matches = findSettings(search);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Find a setting" className="flex flex-col gap-2">
        <SearchInput
          aria-label="Find a setting"
          placeholder="Find a setting, for example check-in, NUIS, webhook"
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
      {!ready ? (
        hidden.setupGuide ? (
          <div>
            <Button variant="link" size="sm" onClick={() => hide.mutate({ setupGuide: false })}>
              Setup: {done} of {steps.length} done · Show
            </Button>
          </div>
        ) : (
          <SetupGuide
            title="Set up your hotel"
            description={`${done} of ${steps.length} done. Finish these and guests can book and pay online.`}
            steps={guide}
            headerAction={
              <Button variant="outline" size="sm" onClick={() => hide.mutate({ setupGuide: true })}>
                Hide for now
              </Button>
            }
          />
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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="m-0 text-base font-semibold">Settings at a glance</h4>
          <p className="m-0 text-xs text-muted-foreground">
            Read-only summary. Edit opens the tab.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {settingsGlance(property, steps, query.data.attention ?? []).map((card) => {
            const tab = settingsTab(card.tab);
            return (
              <Card key={card.tab} className="gap-3">
                <CardHeader>
                  <CardTitle className="text-base">{tab.label}</CardTitle>
                  <CardAction>
                    <Badge variant={card.badge.tone}>{card.badge.label}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <dl className="m-0 flex flex-col">
                    {card.items.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-b-0"
                      >
                        <dt className="shrink-0 text-xs text-muted-foreground">{item.label}</dt>
                        <dd className="m-0 min-w-0 break-words text-right font-medium">
                          {item.value ?? '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-auto">
                    {tab.available ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={link(card.tab)}>{canWrite ? 'Edit' : 'View'}</a>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        title="This page is not built yet"
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
