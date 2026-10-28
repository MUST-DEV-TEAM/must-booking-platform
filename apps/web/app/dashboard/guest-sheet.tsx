'use client';
import { MoneyList } from './approximate-money';

import { Mail, Phone } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DetailList, SectionLabel } from '../../components/ui/detail-list';
import { QuickPeek } from '../../components/ui/quick-peek';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { type GuestStats } from './guest-stats';
import { guestHref, paymentHref } from './payment-detail';
import { guestName as bookingGuestName, type Reservation } from './reservations';

export type GuestSummary = {
  source?: 'CLOCK' | 'MUST';
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

export const dayLabel = (iso: string | undefined, withYear = true) => {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
};

export const stayLabel = (stay: { startsOn: string; endsOn: string } | undefined) =>
  stay ? `${dayLabel(stay.startsOn, false)} – ${dayLabel(stay.endsOn)}` : undefined;

/** Returning or first-time, balance and duplicate flags, as small badges. */
export function GuestBadges({ stats, duplicate }: { stats?: GuestStats; duplicate?: boolean }) {
  return (
    <>
      {stats ? (
        <Badge
          variant={stats.kind === 'returning' ? 'success' : 'secondary'}
          className="rounded-full px-2 py-0 text-[10px]"
        >
          {stats.kind === 'returning' ? 'Returning' : 'First-time'}
        </Badge>
      ) : null}
      {stats?.current ? (
        <Badge variant="info" className="rounded-full px-2 py-0 text-[10px]">
          In house
        </Badge>
      ) : null}
      {stats?.hasBalance ? (
        <Badge variant="warning" className="rounded-full px-2 py-0 text-[10px]">
          Has balance
        </Badge>
      ) : null}
      {duplicate ? (
        <Badge variant="warning" className="rounded-full px-2 py-0 text-[10px]">
          Possible duplicate
        </Badge>
      ) : null}
    </>
  );
}

/** The quick look at a guest that opens from the directory: who, how they stand, latest stays. */
export function GuestSheet({
  guest,
  stats,
  bookings,
  duplicate,
  tenantId,
  propertyId,
  onClose,
}: {
  guest: GuestSummary | null;
  stats?: GuestStats;
  /** Every booking of this guest, newest first. */
  bookings: Reservation[];
  duplicate?: boolean;
  tenantId: string;
  propertyId: string;
  onClose: () => void;
}) {
  const name = guest
    ? [guest.firstName, guest.lastName].filter(Boolean).join(' ') || guest.email
    : '';
  const recent = bookings.slice(0, 3);
  return (
    <QuickPeek
      open={guest !== null}
      onClose={onClose}
      title={name}
      description={guest?.email}
      badges={
        guest?.source === 'CLOCK' ? (
          <Badge variant="secondary">Clock profile</Badge>
        ) : (
          <GuestBadges stats={stats} duplicate={duplicate} />
        )
      }
      actions={
        guest ? (
          <>
            {guest.source !== 'CLOCK' ? (
              <Button size="sm" asChild className="flex-1">
                <a href={guestHref(tenantId, propertyId, guest.id)}>Open profile</a>
              </Button>
            ) : null}
            {guest.email ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`mailto:${guest.email}`}>
                  <Mail aria-hidden="true" /> Email
                </a>
              </Button>
            ) : null}
            {guest.phone ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`tel:${guest.phone.replaceAll(' ', '')}`}>
                  <Phone aria-hidden="true" /> Call
                </a>
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {guest ? (
        <>
          {guest.source === 'CLOCK' ? (
            <p className="text-sm text-muted-foreground">
              Imported Clock profile. Contact details are managed in Clock; stay history appears as
              bookings are synchronized.
            </p>
          ) : null}
          <DetailList
            className="rounded-lg border px-3"
            items={[
              { label: 'Email', value: guest.email },
              { label: 'Phone', value: guest.phone ?? 'Not on file' },
              { label: 'Guest since', value: dayLabel(stats?.firstBookedAt?.slice(0, 10)) },
            ]}
          />
          {stats ? (
            <DetailList
              className="rounded-lg border px-3"
              items={[
                {
                  label: 'Reservations',
                  value: `${stats.bookings}${stats.cancelled ? ` (${stats.cancelled} cancelled)` : ''}`,
                },
                {
                  label: 'Net paid',
                  value: <MoneyList tenantId={tenantId} propertyId={propertyId} list={stats.net} />,
                },
                {
                  label: 'Still owed',
                  value: (
                    <MoneyList
                      tenantId={tenantId}
                      propertyId={propertyId}
                      list={stats.outstanding}
                    />
                  ),
                },
                { label: 'Staying now', value: stayLabel(stats.current) },
                { label: 'Next stay', value: stayLabel(stats.next) },
                { label: 'Last stay', value: stayLabel(stats.last) },
              ]}
            />
          ) : null}
          <div className="space-y-2">
            <SectionLabel>Latest reservations</SectionLabel>
            {recent.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No reservations found.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
                {recent.map((booking) => (
                  <li key={booking.id}>
                    <a
                      href={paymentHref(tenantId, propertyId, booking.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-inherit no-underline hover:bg-muted/60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {booking.externalReference ?? bookingGuestName(booking)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {stayLabel(booking)} · {booking.roomTypeName}
                        </span>
                      </span>
                      <BookingStatusBadge status={booking.status} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </QuickPeek>
  );
}
