'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle } from '../../components/ui/card';
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
  minorUnits,
  outstandingAmount,
  PAYMENT_BADGE_TONE,
  paymentStatus,
  sortNewestFirst,
  summarize,
} from './payment-status';
import { fetchPropertyBookings, guestName, type Reservation } from './reservations';

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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
  const totals = useMemo(() => summarize(bookings), [bookings]);
  const pageBookings = bookings.slice((page - 1) * pageSize, page * pageSize);

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
  const cancelled = bookings.filter((booking) => booking.status === 'CANCELLED').length;
  const joined = (pick: (row: (typeof totals.byCurrency)[number]) => string) =>
    totals.byCurrency.map((row) => formattedMoney(pick(row), row.currency)).join(' · ') || '—';
  const hasOutstanding = totals.byCurrency.some((row) => minorUnits(row.outstanding) > 0n);

  return (
    <div className="space-y-5">
      <DetailHeader
        backHref={backToGuestsHref(tenantId, propertyId)}
        backLabel="All guests"
        title={guestName(profile)}
        subtitle={
          [profile.guestEmail, profile.guestPhone, address].filter(Boolean).join(' · ') ||
          'No contact details on file'
        }
      />

      <div aria-label="Guest summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="group">
        <StatTile
          label="Bookings"
          size="sm"
          value={bookings.length}
          note={cancelled > 0 ? `${cancelled} cancelled` : undefined}
        />
        <StatTile label="Collected" size="sm" value={joined((row) => row.collected)} />
        <StatTile label="Refunded" size="sm" value={joined((row) => row.refunded)} />
        <StatTile label="Net received" size="sm" value={joined((row) => row.net)} />
        <StatTile
          label="Outstanding"
          size="sm"
          value={joined((row) => row.outstanding)}
          tone={hasOutstanding ? 'warning' : 'default'}
        />
      </div>

      <Card className="gap-0 overflow-clip p-0">
        <CardHeader className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Reservation history</CardTitle>
              <p className="m-0 text-sm text-muted-foreground">
                Every booking linked to this guest at the selected property.
              </p>
            </div>
            <Badge variant="secondary">{bookings.length} bookings</Badge>
          </div>
        </CardHeader>
        <Table containerClassName="overflow-x-clip" className="text-xs">
          <TableHeader className="sticky top-[var(--app-header-height,86px)] z-20 bg-muted">
            <TableRow className="hover:bg-muted">
              <TableHead className="px-3 py-2">Reference</TableHead>
              <TableHead className="px-2 py-2">Stay</TableHead>
              <TableHead className="px-2 py-2">Booking</TableHead>
              <TableHead className="px-2 py-2">Payment</TableHead>
              <TableHead className="px-2 py-2 text-right">Total</TableHead>
              <TableHead className="px-2 py-2 text-right">Paid</TableHead>
              <TableHead className="px-2 py-2 text-right">Refunded</TableHead>
              <TableHead className="px-2 py-2 text-right">Outstanding</TableHead>
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
                    <span className="block whitespace-nowrap">
                      {booking.startsOn && booking.endsOn
                        ? `${formatDay(booking.startsOn, false)} → ${formatDay(booking.endsOn, true)}`
                        : '—'}
                    </span>
                    {booking.roomTypeName ? (
                      <span className="block text-[10px] text-muted-foreground">
                        {booking.roomTypeName}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {booking.status ? <BookingStatusBadge status={booking.status} /> : null}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    <Badge
                      variant={PAYMENT_BADGE_TONE[status.state]}
                      className="rounded-full px-2 py-0 text-[10px]"
                    >
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right font-medium tabular-nums">
                    {amount(booking.total.amount)}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right tabular-nums">
                    {amount(booking.paidAmount)}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right tabular-nums">
                    {amount(booking.refundedAmount)}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right tabular-nums">
                    {amount(outstandingAmount(booking))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
  );
}
