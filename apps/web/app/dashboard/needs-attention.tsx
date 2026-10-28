'use client';

import { HotelMoney } from './approximate-money';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarClock, CreditCard, TriangleAlert, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { BookingReviewCard } from './booking-review-card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { DetailList } from '../../components/ui/detail-list';
import { PageHero } from '../../components/ui/page-hero';
import { SearchInput } from '../../components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { StatTile } from '../../components/ui/stat-tile';
import {
  EmptyPanel,
  ErrorPanel,
  ListSkeleton,
  NoResultsPanel,
} from '../../components/ui/state-panel';
import { BookingStatusBadge, PaymentStatusBadge } from '../../components/ui/status-badge';
import { TabBar } from '../../components/ui/tab-bar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  attentionIssue,
  PRIORITY_RANK,
  type AttentionGroup,
  type AttentionPriority,
} from '../../lib/attention';
import {
  balanceDue,
  bookingWasNotCreated,
  NO_BOOKING_BALANCE,
  nightsBetween,
} from '../../lib/reservation-display';
import { cn } from '../../lib/utils';

type Row = {
  id: string;
  externalReference: string;
  status: string;
  paymentMethod: string;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  roomName: string | null;
  roomTypeName: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
};

type Item = Row & { issue: ReturnType<typeof attentionIssue>; guest: string };

const guestOf = (row: Row) =>
  [row.guestFirstName, row.guestLastName].filter(Boolean).join(' ') ||
  row.guestEmail ||
  'Unknown guest';
const money = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

type Focus = 'all' | 'bookings' | 'payments' | 'urgent';
type Sort = 'priority' | 'newest' | 'arrival';

function openRecord(tenantId: string, propertyId: string, id: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=reservations&reservation=${id}`;
}

/**
 * The queue of reservations that need a person: held for review, payment failed, or the hotel
 * system did not answer. Summary tiles and tabs narrow the list; selecting a row shows why it
 * was flagged and what to do next.
 */
export function NeedsAttentionTab({
  tenantId,
  propertyId,
  canEdit = false,
}: {
  tenantId: string;
  propertyId: string;
  canEdit?: boolean;
}) {
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const dismiss = useMutation({
    mutationFn: async (bookingId: string) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/review/dismiss`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note }),
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Could not close this issue.');
      }
    },
    onSuccess: async () => {
      setNote('');
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const [focus, setFocus] = useState<Focus>('all');
  const [priority, setPriority] = useState<'all' | AttentionPriority>('all');
  const [sort, setSort] = useState<Sort>('priority');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['dashboard', 'needs-attention-queue', tenantId, propertyId],
    queryFn: async (): Promise<Row[]> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/search?view=needs_attention&sort=created&direction=desc&pageSize=100`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`Unable to load the queue (${response.status}).`);
      return ((await response.json()) as { items?: Row[] }).items ?? [];
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const items: Item[] = useMemo(
    () =>
      (query.data ?? []).map((row) => ({
        ...row,
        issue: attentionIssue(row.status),
        guest: guestOf(row),
      })),
    [query.data],
  );
  const count = (group: AttentionGroup) =>
    items.filter((item) => item.issue.group === group).length;
  const urgent = items.filter((item) => item.issue.priority === 'urgent').length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((item) => {
        if ((focus === 'bookings' || focus === 'payments') && item.issue.group !== focus)
          return false;
        if (focus === 'urgent' && item.issue.priority !== 'urgent') return false;
        if (priority !== 'all' && item.issue.priority !== priority) return false;
        if (!term) return true;
        return [
          item.externalReference,
          item.guest,
          item.issue.title,
          item.roomTypeName,
          item.roomName ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);
      })
      .sort((a, b) => {
        if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
        if (sort === 'arrival') return a.startsOn.localeCompare(b.startsOn);
        return (
          PRIORITY_RANK[a.issue.priority] - PRIORITY_RANK[b.issue.priority] ||
          a.startsOn.localeCompare(b.startsOn)
        );
      });
  }, [items, focus, priority, sort, search]);

  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const filtered = focus !== 'all' || priority !== 'all' || search.trim() !== '';
  const clear = () => {
    setFocus('all');
    setPriority('all');
    setSearch('');
  };
  const reviewNext = () => {
    if (visible.length === 0) return;
    const at = visible.findIndex((item) => item.id === selected?.id);
    setSelectedId(visible[(at + 1) % visible.length]!.id);
  };
  const overviewHref = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=overview&tab=overview`;

  const hero = (
    <PageHero
      eyebrow="Dashboard · Exception queue"
      title="Needs attention"
      description="Review reservations and payments that need staff follow-up."
      actions={
        <>
          <Button variant="outline" asChild>
            <a href={overviewHref}>
              <ArrowLeft aria-hidden="true" /> Dashboard overview
            </a>
          </Button>
          <Button onClick={reviewNext} disabled={visible.length === 0}>
            Review next <ArrowRight aria-hidden="true" />
          </Button>
        </>
      }
    />
  );

  if (query.isPending)
    return (
      <div className="space-y-4">
        {hero}
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading needs attention…</span>
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  if (query.isError)
    return (
      <div className="space-y-4">
        {hero}
        <ErrorPanel
          title="Needs attention unavailable"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  if (items.length === 0)
    return (
      <div className="space-y-4">
        {hero}
        <EmptyPanel
          title="No bookings need attention"
          description="No bookings need attention right now."
          action={
            <Button variant="outline" size="sm" asChild>
              <a href={overviewHref}>Back to Overview</a>
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="space-y-4">
      {hero}

      <section aria-label="Queue overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open issues"
          icon={TriangleAlert}
          value={items.length}
          note="All booking and payment items"
          active={focus === 'all'}
          onClick={() => setFocus('all')}
        />
        <StatTile
          label="Booking review"
          icon={CalendarClock}
          value={count('bookings')}
          note="Reservations awaiting review"
          active={focus === 'bookings'}
          onClick={() => setFocus('bookings')}
        />
        <StatTile
          label="Payment follow-up"
          icon={CreditCard}
          value={count('payments')}
          note="Payments to verify or recover"
          active={focus === 'payments'}
          onClick={() => setFocus('payments')}
        />
        <StatTile
          label="Urgent"
          icon={Zap}
          tone={urgent > 0 ? 'danger' : 'default'}
          value={urgent}
          note="Requires prompt review"
          active={focus === 'urgent'}
          onClick={() => setFocus('urgent')}
        />
      </section>

      <Card className="gap-4 py-4">
        <CardContent className="space-y-3 px-4">
          <TabBar
            label="Queue groups"
            current={focus === 'urgent' ? 'all' : focus}
            onSelect={(id) => setFocus(id as Focus)}
            tabs={[
              { id: 'all', label: 'All issues', count: items.length },
              { id: 'bookings', label: 'Bookings', count: count('bookings') },
              { id: 'payments', label: 'Payments', count: count('payments') },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              aria-label="Search the queue"
              placeholder="Search reservation, guest or issue"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-56 flex-1"
            />
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as typeof priority)}
            >
              <SelectTrigger aria-label="Priority" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="review">Review</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
              <SelectTrigger aria-label="Sort by" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Sort: Priority</SelectItem>
                <SelectItem value="newest">Sort: Newest</SelectItem>
                <SelectItem value="arrival">Sort: Arrival date</SelectItem>
              </SelectContent>
            </Select>
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="gap-0 py-0">
          <div className="border-b px-5 py-4">
            <h3 className="m-0 text-base font-bold">Open queue</h3>
            <p className="m-0 text-xs text-muted-foreground">
              {visible.length} of {items.length} issues · Select a row to see details
            </p>
          </div>
          {visible.length === 0 ? (
            <div className="p-6">
              <NoResultsPanel onClear={clear} />
            </div>
          ) : (
            <Table
              aria-label="Bookings needing attention"
              containerClassName="overflow-x-clip"
              className="text-[11px]"
            >
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead className="px-4 py-2 normal-case tracking-normal">Issue</TableHead>
                  <TableHead className="px-2 py-2 normal-case tracking-normal">
                    Reservation · Guest
                  </TableHead>
                  <TableHead className="px-2 py-2 normal-case tracking-normal">
                    Room · Stay
                  </TableHead>
                  <TableHead className="px-2 py-2 normal-case tracking-normal">
                    Booking · Payment
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow
                    key={item.id}
                    data-state={selected?.id === item.id ? 'selected' : undefined}
                    tabIndex={0}
                    aria-selected={selected?.id === item.id}
                    onClick={() => setSelectedId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(item.id);
                      }
                    }}
                    className={cn(
                      'h-14 cursor-pointer',
                      selected?.id === item.id && 'bg-primary/10 hover:bg-primary/10',
                    )}
                  >
                    <TableCell className="px-4 py-2">
                      <div className="text-xs font-semibold">{item.issue.title}</div>
                      <PriorityBadge priority={item.issue.priority} />
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div className="font-mono text-[11px]">{item.externalReference}</div>
                      <div className="text-xs">{item.guest}</div>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div className="text-xs">{item.roomName ?? 'Not assigned'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {item.roomTypeName} · {day(item.startsOn)}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <BookingStatusBadge status={item.status} />
                        <PaymentStatusBadge
                          status={item.status}
                          paymentMethod={item.paymentMethod}
                          total={item.total.amount}
                          paid={item.paidAmount}
                          refunded={item.refundedAmount}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {selected ? (
          <Card className="gap-4">
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <PriorityBadge priority={selected.issue.priority} />
                <span className="text-xs text-muted-foreground">
                  {selected.issue.group === 'payments' ? 'Payment follow-up' : 'Booking review'}
                </span>
              </div>
              <div>
                <h3 className="m-0 text-lg font-extrabold">{selected.issue.title}</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  {selected.externalReference} · {selected.guest}
                </p>
              </div>
              <div className="space-y-1 rounded-lg bg-muted/60 p-3">
                <p className="m-0 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                  Why this is flagged
                </p>
                <p className="m-0 text-sm">{selected.issue.reason}</p>
              </div>
              <DetailList
                items={[
                  {
                    label: 'Room',
                    value: `${selected.roomName ?? 'Not assigned'} · ${selected.roomTypeName}`,
                  },
                  {
                    label: 'Stay',
                    value: `${day(selected.startsOn)} · ${nightsBetween(selected.startsOn, selected.endsOn)} nights`,
                  },
                  {
                    label: 'Booking total',
                    value: (
                      <HotelMoney
                        tenantId={tenantId}
                        propertyId={propertyId}
                        amount={selected.total.amount}
                        currency={selected.total.currency}
                      />
                    ),
                  },
                  {
                    label: 'Balance due',
                    value: bookingWasNotCreated(selected.status)
                      ? NO_BOOKING_BALANCE
                      : ['PMS_UNKNOWN_RESULT', 'MANUAL_REVIEW'].includes(selected.status)
                        ? 'Balance not confirmed'
                        : money(
                            String(
                              balanceDue({
                                status: selected.status,
                                total: selected.total.amount,
                                paid: selected.paidAmount,
                                refunded: selected.refundedAmount,
                              }),
                            ),
                            selected.total.currency,
                          ),
                  },
                ]}
              />
              <div className="space-y-1 rounded-lg border border-warning/30 bg-warning-surface p-3">
                <p className="m-0 text-[10px] font-bold tracking-wide text-warning uppercase">
                  Recommended next step
                </p>
                <p className="m-0 text-sm">{selected.issue.nextStep}</p>
              </div>
              {['PMS_UNKNOWN_RESULT', 'MANUAL_REVIEW'].includes(selected.status) ? (
                <BookingReviewCard
                  key={selected.id}
                  tenantId={tenantId}
                  propertyId={propertyId}
                  bookingId={selected.id}
                  canRunCheck={canEdit}
                />
              ) : null}
              {canEdit &&
              bookingWasNotCreated(selected.status) &&
              Number(selected.paidAmount) <= Number(selected.refundedAmount) ? (
                <div className="space-y-2">
                  <Input
                    aria-label="Review note"
                    placeholder="Why can this unsuccessful attempt be closed?"
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={note.trim().length < 3 || dismiss.isPending}
                    onClick={() => dismiss.mutate(selected.id)}
                  >
                    Close unsuccessful attempt
                  </Button>
                  <Button variant="outline" asChild>
                    <a
                      href={`/dashboard/${tenantId}?propertyId=${propertyId}&section=overview&tab=quick-booking`}
                    >
                      Search availability again
                    </a>
                  </Button>
                </div>
              ) : null}
              {dismiss.error ? <p role="alert">{dismiss.error.message}</p> : null}
              <Button className="w-full" asChild>
                <a href={openRecord(tenantId, propertyId, selected.id)}>
                  Open reservation record <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: AttentionPriority }) {
  return (
    <Badge
      variant={priority === 'urgent' ? 'danger' : 'warning'}
      className="rounded-full px-2 py-0 text-[10px] font-semibold"
    >
      {priority === 'urgent' ? 'Urgent' : 'Review'}
    </Badge>
  );
}
