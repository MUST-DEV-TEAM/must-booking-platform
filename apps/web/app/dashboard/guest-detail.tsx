'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, CalendarPlus, Mail, Pencil, Phone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ActivityFeed, type ActivityEntry } from '../../components/ui/activity-feed';
import { DetailList } from '../../components/ui/detail-list';
import { TabBar } from '../../components/ui/tab-bar';
import { nightsBetween } from '../../lib/reservation-display';
import { formatMoneyList, guestStatsById } from './guest-stats';
import { dayLabel, GuestBadges, stayLabel } from './guest-sheet';

import { Badge } from '../../components/ui/badge';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailHeader } from '../../components/ui/detail-header';
import { ListCard, ListRow } from '../../components/ui/list-card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { StatTile } from '../../components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { guestHref, paymentHref } from './payment-detail';
import {
  outstandingAmount,
  PAYMENT_BADGE_TONE,
  paymentMethodLabel,
  paymentStatus,
  sortNewestFirst,
} from './payment-status';
import { fetchPropertyBookings, guestName, type Reservation } from './reservations';

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type ProfileTab = 'reservations' | 'payments' | 'activity';
const todayIso = () => new Date().toISOString().slice(0, 10);
const reservationHref = (tenantId: string, propertyId: string, bookingId: string) =>
  `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=reservations&reservation=${encodeURIComponent(bookingId)}`;

function formatDay(value: string | undefined, withYear: boolean) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase();
}

function fullName(booking: Reservation) {
  return normalize([booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' '));
}

/** Other guest profiles that look like the same person: same email or same full name. */
export function possibleDuplicates(guestId: string, bookings: Reservation[]) {
  const own = bookings.filter((booking) => booking.guestId === guestId);
  const emails = new Set(own.map((booking) => normalize(booking.guestEmail)).filter(Boolean));
  const names = new Set(own.map(fullName).filter(Boolean));
  const others = new Map<string, Reservation>();
  for (const booking of bookings) {
    if (!booking.guestId || booking.guestId === guestId || others.has(booking.guestId)) continue;
    if (emails.has(normalize(booking.guestEmail)) || names.has(fullName(booking)))
      others.set(booking.guestId, booking);
  }
  return [...others.values()];
}

export function backToGuestsHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=guests`;
}

function BackToGuests({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  return (
    <Button variant="link" size="sm" asChild className="h-auto !px-0 py-0 text-xs">
      <a href={backToGuestsHref(tenantId, propertyId)}>← All guests</a>
    </Button>
  );
}

function formattedMoney(amount: string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
}

/** One guest profile, built from the property's existing booking and payment data. */
export function GuestDetail({
  tenantId,
  propertyId,
  guestId,
}: {
  tenantId: string;
  propertyId: string;
  guestId: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [tab, setTab] = useState<ProfileTab>('reservations');
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
  });
  const all = bookingsQuery.data;
  const bookings = useMemo(
    () => sortNewestFirst((all ?? []).filter((booking) => booking.guestId === guestId)),
    [all, guestId],
  );
  const duplicates = useMemo(() => possibleDuplicates(guestId, all ?? []), [all, guestId]);

  useEffect(() => setPage(1), [guestId]);

  if (bookingsQuery.isPending)
    return (
      <div className="space-y-5">
        <BackToGuests tenantId={tenantId} propertyId={propertyId} />
        <PageHeader title="Guest profile" />
        <ListSkeleton rows={5} />
      </div>
    );
  if (bookingsQuery.error)
    return (
      <div className="space-y-5">
        <BackToGuests tenantId={tenantId} propertyId={propertyId} />
        <ErrorPanel
          title="Guest profile could not be loaded"
          description={bookingsQuery.error.message}
          onRetry={() => void bookingsQuery.refetch()}
        />
      </div>
    );
  if (bookings.length === 0)
    return (
      <div className="space-y-5">
        <BackToGuests tenantId={tenantId} propertyId={propertyId} />
        <EmptyPanel
          title="Guest not found"
          description="This guest has no bookings in this property."
        />
      </div>
    );

  // The newest booking carries the most recent contact details.
  const profile = bookings[0]!;
  const address = [
    profile.guestStreetAddress,
    profile.guestAddressLine2,
    profile.guestCity,
    profile.guestCounty,
    profile.guestPostcode,
  ]
    .filter(Boolean)
    .join(', ');
  const stats = guestStatsById(bookings, todayIso()).get(guestId);
  const name = guestName(profile);
  const nextLabel = stats?.current
    ? { label: 'Staying now', value: stayLabel(stats.current) }
    : stats?.next
      ? { label: 'Next stay', value: stayLabel(stats.next) }
      : { label: 'Last stay', value: stayLabel(stats?.last) };
  const feed: ActivityEntry[] = bookings
    .flatMap((booking) => {
      const entries: ActivityEntry[] = [
        {
          key: `created-${booking.id}`,
          title: `Reservation ${booking.externalReference ?? ''} created`,
          detail: `${stayLabel(booking) ?? ''} · ${booking.roomTypeName}`,
          at: booking.createdAt,
          icon: CalendarPlus,
        },
      ];
      if (booking.status === 'CANCELLED')
        entries.push({
          key: `cancelled-${booking.id}`,
          title: `Reservation ${booking.externalReference ?? ''} cancelled`,
          detail: Number(booking.refundedAmount) > 0 ? `Refunded ${formattedMoney(booking.refundedAmount, booking.total.currency)}` : undefined,
          at: booking.updatedAt,
          icon: Ban,
          tone: 'danger',
        });
      return entries;
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const pageBookings = bookings.slice((page - 1) * pageSize, page * pageSize);
  const pagination = (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={bookings.length}
      onPage={setPage}
      noun="reservations"
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageSize={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  return (
    <div className="space-y-5">
      <DetailHeader
        backHref={backToGuestsHref(tenantId, propertyId)}
        backLabel="All guests"
        title={name}
        subtitle={[profile.guestEmail, profile.guestPhone].filter(Boolean).join(' · ') || 'No contact details on file'}
        badges={<GuestBadges stats={stats} duplicate={duplicates.length > 0} />}
        actions={
          <>
            {profile.guestEmail ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${profile.guestEmail}`}>
                  <Mail aria-hidden="true" /> Email
                </a>
              </Button>
            ) : null}
            {profile.guestPhone ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${profile.guestPhone.replaceAll(' ', '')}`}>
                  <Phone aria-hidden="true" /> Call
                </a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled title="Editing guest details is not available yet">
              <Pencil aria-hidden="true" /> Edit
            </Button>
          </>
        }
      />

      <div aria-label="Guest summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group">
        <StatTile
          label="Reservations"
          size="sm"
          value={stats?.stays ?? bookings.length}
          note={stats && stats.cancelled > 0 ? `${stats.cancelled} cancelled` : undefined}
        />
        <StatTile label="Net paid" size="sm" value={formatMoneyList(stats?.net ?? [])} note="Collected minus refunds" />
        <StatTile
          label="Still owed"
          size="sm"
          value={stats?.hasBalance ? formatMoneyList(stats.outstanding) : '—'}
          tone={stats?.hasBalance ? 'warning' : 'default'}
        />
        <StatTile label={nextLabel.label} size="sm" value={nextLabel.value ?? '—'} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact and identity</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Email', value: profile.guestEmail },
                  { label: 'Phone', value: profile.guestPhone ?? 'Not on file' },
                  { label: 'Address', value: address || 'Not on file' },
                  { label: 'Guest since', value: dayLabel(stats?.firstBookedAt?.slice(0, 10)) },
                  { label: 'Latest booking', value: dayLabel(bookings[0]?.createdAt?.slice(0, 10)) },
                ]}
              />
            </CardContent>
          </Card>
          {duplicates.length > 0 ? (
            <ListCard
              title="Possible duplicate profiles"
              count={duplicates.length}
              description="These profiles share this guest's email or name. Review and merge them from the Guests directory."
            >
              {duplicates.map((other) => (
                <ListRow
                  key={other.guestId}
                  title={guestName(other)}
                  subtitle={other.guestEmail && other.guestEmail !== guestName(other) ? other.guestEmail : undefined}
                  href={guestHref(tenantId, propertyId, other.guestId)}
                />
              ))}
            </ListCard>
          ) : null}
        </div>

        <Card className="gap-0 overflow-clip p-0">
          <div className="border-b px-4 pt-3">
            <TabBar
              tabs={[
                { id: 'reservations', label: 'Reservations', count: bookings.length },
                { id: 'payments', label: 'Payments' },
                { id: 'activity', label: 'Activity', count: feed.length },
              ]}
              current={tab}
              onSelect={(id) => {
                setTab(id as ProfileTab);
                setPage(1);
              }}
              label="Guest sections"
            />
          </div>
          {tab === 'reservations' ? (
            <>
              <Table containerClassName="overflow-x-clip" className="text-[11px]">
                <TableHeader className="bg-muted">
                  <TableRow className="hover:bg-muted">
                    <TableHead className="px-3 py-2">Reservation</TableHead>
                    <TableHead className="px-2 py-2">Stay</TableHead>
                    <TableHead className="px-2 py-2">Room</TableHead>
                    <TableHead className="px-2 py-2">Status</TableHead>
                    <TableHead className="px-2 py-2 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageBookings.map((booking) => {
                    const nights = nightsBetween(booking.startsOn, booking.endsOn);
                    return (
                      <TableRow
                        key={booking.id}
                        className="h-12 cursor-pointer"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a, button')) return;
                          window.location.assign(reservationHref(tenantId, propertyId, booking.id));
                        }}
                      >
                        <TableCell className="px-3 py-2">
                          <a
                            className="font-semibold text-primary no-underline hover:underline"
                            href={reservationHref(tenantId, propertyId, booking.id)}
                          >
                            <code>{booking.externalReference ?? '—'}</code>
                          </a>
                          <span className="block text-[10px] text-muted-foreground">
                            Created {dayLabel(booking.createdAt.slice(0, 10))}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <span className="block whitespace-nowrap">{stayLabel(booking)}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {nights} night{nights === 1 ? '' : 's'}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-2">{booking.roomTypeName}</TableCell>
                        <TableCell className="px-2 py-2">
                          <BookingStatusBadge status={booking.status} />
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right font-semibold tabular-nums">
                          {formattedMoney(booking.total.amount, booking.total.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {pagination}
            </>
          ) : null}
          {tab === 'payments' ? (
            <>
              <Table containerClassName="overflow-x-clip" className="text-[11px]">
                <TableHeader className="bg-muted">
                  <TableRow className="hover:bg-muted">
                    <TableHead className="px-3 py-2">Reservation</TableHead>
                    <TableHead className="px-2 py-2">Payment</TableHead>
                    <TableHead className="px-2 py-2 text-right">Total</TableHead>
                    <TableHead className="px-2 py-2 text-right">Paid</TableHead>
                    <TableHead className="px-2 py-2 text-right">Refunded</TableHead>
                    <TableHead className="px-2 py-2 text-right">Owed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageBookings.map((booking) => {
                    const status = paymentStatus(booking);
                    const amount = (value: string) => formattedMoney(value, booking.total.currency);
                    return (
                      <TableRow key={booking.id} className="h-12">
                        <TableCell className="px-3 py-2">
                          <a
                            className="font-semibold text-primary no-underline hover:underline"
                            href={paymentHref(tenantId, propertyId, booking.id)}
                          >
                            <code>{booking.externalReference ?? '—'}</code>
                          </a>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <Badge variant={PAYMENT_BADGE_TONE[status.state]} className="rounded-full px-2 py-0 text-[10px]">
                            {status.label}
                          </Badge>
                          <span className="block text-[10px] text-muted-foreground">
                            {paymentMethodLabel(booking.paymentMethod)}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{amount(booking.total.amount)}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{amount(booking.paidAmount)}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{amount(booking.refundedAmount)}</TableCell>
                        <TableCell
                          className={`px-2 py-2 text-right tabular-nums ${Number(outstandingAmount(booking)) > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}`}
                        >
                          {amount(outstandingAmount(booking))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {pagination}
            </>
          ) : null}
          {tab === 'activity' ? (
            <div className="p-4">
              <ActivityFeed entries={feed} empty="Nothing has happened for this guest yet." />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
