'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { CalendarPicker } from '../../../components/ui/calendar-picker';
import { FilterChips } from '../../../components/ui/filter-chips';
import { RecordDirectory, type RecordColumn } from '../../../components/ui/record-directory';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { QuickBookingDialog } from './quick-booking-dialog';
import {
  reservationApi,
  type Reservation,
  type ReservationStatus,
  type ReservationListQuery,
} from './reservation-api';
import {
  addDays,
  dateInZone,
  dayLabel,
  dayOfInstant,
  STATUS_DISPLAY,
  timeInZone,
} from './reservation-display';
import { ReservationDetailsDialog } from './reservation-details-dialog';
import { ReservationTimeline, type BookingPrefill } from './reservation-timeline';
export function ReservationsPanel({
  tenantId,
  venueId,
  timezone,
  canManage,
}: {
  tenantId: string;
  venueId: string;
  timezone: string;
  canManage: boolean;
}) {
  const today = dateInZone(timezone);
  const [range, setRange] = useState({ start: today, end: today });
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'startsAt',
    direction: 'asc',
  });
  const [booking, setBooking] = useState<Partial<BookingPrefill> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const from = range.start,
    to = view === 'calendar' ? from : range.end;
  const list = useQuery({
    queryKey: [
      'venue-reservations',
      tenantId,
      venueId,
      view,
      from,
      to,
      search,
      status,
      page,
      pageSize,
      sort,
    ],
    queryFn: async () => {
      const params: ReservationListQuery = {
        from,
        to,
        ...(view === 'calendar' || status === 'all'
          ? {}
          : { status: [status as ReservationStatus] }),
        q: view === 'list' ? search.trim() || undefined : undefined,
        limit: view === 'calendar' ? 500 : pageSize,
        offset: view === 'calendar' ? 0 : (page - 1) * pageSize,
        sort: sort.key as ReservationListQuery['sort'],
        order: sort.direction,
      };
      const result = await reservationApi.list(tenantId, venueId, params);
      if (view === 'calendar')
        while (result.total && result.reservations.length < result.total) {
          if (result.reservations.length >= 50000)
            throw new Error('There are too many bookings for the calendar. Use the list view.');
          const next = await reservationApi.list(tenantId, venueId, {
            ...params,
            offset: result.reservations.length,
          });
          if (!next.reservations.length) break;
          result.reservations.push(...next.reservations);
        }
      return result;
    },
  });
  const columns: RecordColumn<Reservation>[] = [
    {
      id: 'guestName',
      label: 'Guest',
      value: (r) => r.guestName,
      render: (r) => (
        <div>
          <span className="font-semibold">{r.guestName}</span>
          <p className="text-xs text-muted-foreground">
            {[r.reference, r.guestPhone].filter(Boolean).join(' - ')}
          </p>
          {r.stay ? (
            <Badge variant="info">Hotel guest{r.stay.room ? ` - ${r.stay.room}` : ''}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'startsAt',
      label: 'Time',
      value: (r) => r.startsAt,
      render: (r) => (
        <span className="whitespace-nowrap">
          {range.start !== to ? `${dayLabel(dayOfInstant(r.startsAt, timezone))} - ` : ''}
          {timeInZone(r.startsAt, timezone)}-{timeInZone(r.endsAt, timezone)}
        </span>
      ),
    },
    { id: 'partySize', label: 'Guests', value: (r) => r.partySize },
    { id: 'table', label: 'Table', value: (r) => r.tables.map((t) => t.label).join(' + ') },
    {
      id: 'status',
      label: 'Status',
      value: (r) => r.status,
      render: (r) => (
        <Badge variant={STATUS_DISPLAY[r.status].tone}>{STATUS_DISPLAY[r.status].label}</Badge>
      ),
    },
  ];
  const changeRange = (start: string, end: string) => {
    setRange({ start, end });
    setPage(1);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          aria-label="Previous day"
          variant="outline"
          size="icon-sm"
          onClick={() => changeRange(addDays(from, -1), addDays(to, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <CalendarPicker
          label="Booking dates"
          mode={view === 'calendar' ? 'single' : 'range'}
          value={range}
          onChange={(value) => {
            if (value.start) changeRange(value.start, value.end ?? value.start);
          }}
          months={view === 'calendar' ? 1 : 2}
        />
        <Button
          aria-label="Next day"
          variant="outline"
          size="icon-sm"
          onClick={() => changeRange(addDays(from, 1), addDays(to, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => changeRange(today, today)}>
          Today
        </Button>
        <SegmentedControl
          label="View"
          value={view}
          onChange={(value) => {
            setView(value);
            setPage(1);
          }}
          options={[
            { value: 'list', label: 'List' },
            { value: 'calendar', label: 'Calendar' },
          ]}
        />
        {canManage ? (
          <Button className="ml-auto" onClick={() => setBooking({ date: from })}>
            New booking
          </Button>
        ) : null}
      </div>
      {view === 'list' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every status</SelectItem>
              {(Object.keys(STATUS_DISPLAY) as ReservationStatus[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {STATUS_DISPLAY[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <FilterChips
        chips={[
          ...(view === 'calendar' || status === 'all'
            ? []
            : [{ key: 'status', label: STATUS_DISPLAY[status as ReservationStatus].label }]),
          ...(view === 'list' && search ? [{ key: 'search', label: search }] : []),
          ...(from !== today || to !== today
            ? [
                {
                  key: 'dates',
                  label: `${dayLabel(from)}${to !== from ? ` - ${dayLabel(to)}` : ''}`,
                },
              ]
            : []),
        ]}
        onRemove={(key) => {
          if (key === 'status') setStatus('all');
          if (key === 'search') setSearch('');
          if (key === 'dates') changeRange(today, today);
          setPage(1);
        }}
        onClearAll={() => {
          setStatus('all');
          setSearch('');
          changeRange(today, today);
        }}
      />
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading bookings...</p>
      ) : list.error ? (
        <Alert variant="destructive">
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : view === 'calendar' ? (
        <ReservationTimeline
          tenantId={tenantId}
          venueId={venueId}
          timezone={timezone}
          date={from}
          reservations={list.data.reservations}
          onEmpty={canManage ? setBooking : undefined}
          onBooking={(r) => setSelected(r.id)}
        />
      ) : (
        <RecordDirectory
          rows={list.data.reservations}
          columns={columns}
          storageKey={`must.venue.reservations.${tenantId}.${venueId}`}
          onRow={(r) => setSelected(r.id)}
          exportable={false}
          emptyTitle="No bookings match"
          server={{
            search,
            onSearch: (value) => {
              setSearch(value);
              setPage(1);
            },
            sort,
            onSort: (value) => {
              setSort(value);
              setPage(1);
            },
          }}
          pagination={{
            page,
            pageSize,
            total: list.data.total ?? list.data.reservations.length,
            onPage: setPage,
            onPageSize: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />
      )}
      {booking ? (
        <QuickBookingDialog
          key={`${booking.date}-${booking.time}-${booking.tableId}`}
          tenantId={tenantId}
          venueId={venueId}
          today={today}
          initialDate={booking.date ?? from}
          initialTime={booking.time}
          initialTableId={booking.tableId}
          initialAreaId={booking.areaId}
          initialPartySize={booking.partySize}
          onOpenChange={(open) => {
            if (!open) setBooking(null);
          }}
        />
      ) : null}
      {selected ? (
        <ReservationDetailsDialog
          tenantId={tenantId}
          venueId={venueId}
          id={selected}
          timezone={timezone}
          canManage={canManage}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
