'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../../components/ui/state-panel';
import type { Room, RoomType } from './room-management-types';

export type AvailabilityCalendarTarget =
  { kind: 'room-type'; roomType: RoomType } | { kind: 'room'; room: Room; roomType: RoomType };
type CalendarDay = {
  date: string;
  isAvailable: boolean;
  status: 'available' | 'sold_out' | 'closed' | 'unavailable';
};
type AvailabilityBlock = {
  id: string;
  startsOn: string;
  endsOn: string;
  all: boolean;
  roomTypeIds: string[];
  roomIds: string[];
};

/** Month availability for one room type or one room, using the existing availability APIs. */
export function AvailabilityCalendarDialog({
  tenantId,
  propertyId,
  target,
  open,
  canBlock,
  onOpenChange,
}: {
  tenantId: string;
  propertyId: string;
  target: AvailabilityCalendarTarget | null;
  open: boolean;
  canBlock: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [selection, setSelection] = useState<{ start: string; end: string | null } | null>(null);
  const queryClient = useQueryClient();
  const base = '/api/tenants/' + tenantId + '/properties/' + propertyId;
  const targetId = target?.kind === 'room' ? target.room.id : target?.roomType.id;
  const roomTypeId = target?.roomType.id;
  const queryKey = [
    'dashboard',
    'accommodation-calendar',
    tenantId,
    propertyId,
    target?.kind,
    targetId,
    month,
  ] as const;

  const calendarQuery = useQuery({
    queryKey,
    enabled: open && target !== null,
    queryFn: async () => {
      const params = new URLSearchParams({ roomTypeId: roomTypeId!, month });
      if (target?.kind === 'room') params.set('roomId', target.room.id);
      const response = await fetch(base + '/availability-calendar?' + params.toString(), {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await responseError(response, 'Unable to load calendar.'));
      return (await response.json()) as { days: CalendarDay[] };
    },
  });
  const blocksQuery = useQuery({
    queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
    enabled: open && target !== null,
    queryFn: async () => {
      const response = await fetch(base + '/availability-blocks', { credentials: 'include' });
      if (!response.ok)
        throw new Error(await responseError(response, 'Unable to load availability blocks.'));
      return (await response.json()) as AvailabilityBlock[];
    },
  });
  const selectedRoomAvailabilityQuery = useQuery({
    queryKey: [
      'dashboard',
      'room-availability-day',
      tenantId,
      propertyId,
      targetId,
      selection?.start,
    ],
    enabled: open && target?.kind === 'room' && selection !== null,
    queryFn: async () => {
      const params = new URLSearchParams({
        startsOn: selection!.start,
        endsOn: addDays(selection!.start, 1),
      });
      const response = await fetch(
        base + '/rooms/' + targetId + '/availability?' + params.toString(),
        {
          credentials: 'include',
        },
      );
      if (!response.ok)
        throw new Error(await responseError(response, 'Unable to check this room night.'));
      return (await response.json()) as { isAvailable: boolean };
    },
  });
  const createBlockMutation = useMutation({
    mutationFn: async () => {
      if (!target || !selection?.end) throw new Error('Select the first and last night to block.');
      const response = await fetch(base + '/availability-blocks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startsOn: selection.start,
          endsOn: addDays(selection.end, 1),
          all: false,
          roomTypeIds: target.kind === 'room-type' ? [target.roomType.id] : [],
          roomIds: target.kind === 'room' ? [target.room.id] : [],
        }),
      });
      if (!response.ok)
        throw new Error(await responseError(response, 'Unable to block these nights.'));
    },
    onSuccess: async () => {
      setSelection(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ['dashboard', 'availability-blocks', tenantId, propertyId],
        }),
      ]);
      toast.success('Availability block created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to block these nights.'),
  });

  const title =
    target?.kind === 'room' ? target.room.name + ' calendar' : target?.roomType.name + ' calendar';
  const blocks = blocksQuery.data ?? [];
  const days = (calendarQuery.data?.days ?? []).map((day) => ({
    ...day,
    status: isBlocked(day.date, target, blocks) ? ('closed' as const) : day.status,
  }));
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const cells = monthCells(month);
  const selectedAvailable = selectedRoomAvailabilityQuery.data?.isAvailable;
  const blockStart = selection?.start;
  const blockEnd = selection?.end;

  function selectDay(date: string) {
    setSelection((current) => {
      if (!current || current.end) return { start: date, end: null };
      if (date < current.start) return { start: date, end: current.start };
      return { start: current.start, end: date };
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? 'Availability calendar'}</DialogTitle>
          <DialogDescription>
            {target?.kind === 'room'
              ? 'Availability for this physical room.'
              : 'Availability across this room type.'}
            {!canBlock
              ? ' Read-only access.'
              : ' Select the first and last night, then block them.'}
          </DialogDescription>
        </DialogHeader>
        {!target ? <EmptyPanel title="Choose a room type or room" /> : null}
        {calendarQuery.isPending || blocksQuery.isPending ? <ListSkeleton rows={4} /> : null}
        {calendarQuery.isError ? (
          <ErrorPanel
            title="Calendar unavailable"
            description={calendarQuery.error.message}
            onRetry={() => void calendarQuery.refetch()}
          />
        ) : null}
        {blocksQuery.isError ? (
          <ErrorPanel
            title="Availability blocks unavailable"
            description={blocksQuery.error.message}
            onRetry={() => void blocksQuery.refetch()}
          />
        ) : null}
        {target && calendarQuery.data && blocksQuery.data ? (
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous month"
                  onClick={() => setMonth((value) => shiftMonth(value, -1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <h3 className="m-0 text-base font-bold">{monthLabel(month)}</h3>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next month"
                  onClick={() => setMonth((value) => shiftMonth(value, 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((date, index) => {
                  if (!date)
                    return (
                      <span
                        key={'empty-' + index}
                        aria-hidden="true"
                        className="min-h-14 rounded-md"
                      />
                    );
                  const day = daysByDate.get(date);
                  const blocked = day?.status === 'closed';
                  const isToday = date === todayIso();
                  const inSelection =
                    !!blockStart && date >= blockStart && date <= (blockEnd ?? blockStart);
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={dateLabel(date) + ', ' + statusLabel(day?.status)}
                      aria-pressed={inSelection}
                      disabled={day === undefined}
                      onClick={() => selectDay(date)}
                      className={[
                        'flex min-h-14 flex-col items-center justify-center gap-1 rounded-md border bg-card text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-70',
                        statusClass(day?.status),
                        inSelection ? 'ring-2 ring-primary' : '',
                        isToday ? 'border-primary font-bold' : '',
                      ].join(' ')}
                      data-today={isToday || undefined}
                    >
                      <span>{Number(date.slice(-2))}</span>
                      {isToday ? <span className="text-[10px] text-primary">Today</span> : null}
                      {blocked ? <span className="text-[10px]">Closed</span> : null}
                    </button>
                  );
                })}
              </div>
              <div aria-label="Availability legend" className="flex flex-wrap gap-2">
                <Badge variant="success">Available</Badge>
                <Badge variant="warning">Sold out</Badge>
                <Badge variant="muted">Closed</Badge>
                <Badge variant="outline">Unavailable</Badge>
              </div>
              {target.kind === 'room' && selection ? (
                <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
                  Selected night:{' '}
                  {selectedRoomAvailabilityQuery.isPending
                    ? 'Checking…'
                    : selectedAvailable === undefined
                      ? 'Status unavailable'
                      : selectedAvailable
                        ? 'Available'
                        : 'Unavailable'}
                </p>
              ) : null}
              {canBlock && selection ? (
                <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
                  {blockEnd
                    ? 'Selected nights: ' +
                      dateLabel(blockStart!) +
                      ' through ' +
                      dateLabel(blockEnd)
                    : 'Choose the last night to finish the range.'}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canBlock && target ? (
            <Button
              type="button"
              disabled={!selection?.end || createBlockMutation.isPending}
              loading={createBlockMutation.isPending}
              onClick={() => createBlockMutation.mutate()}
            >
              Block these nights
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function currentMonth() {
  const date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function todayIso() {
  const date = new Date();
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

function monthCells(month: string) {
  const [year, numericMonth] = month.split('-').map(Number);
  const firstWeekday = (new Date(year, numericMonth - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, numericMonth, 0).getDate();
  const cells: Array<string | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= dayCount; day++)
    cells.push(
      year + '-' + String(numericMonth).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
    );
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function shiftMonth(month: string, amount: number) {
  const [year, numericMonth] = month.split('-').map(Number);
  return (
    new Date(year, numericMonth - 1 + amount, 1).getFullYear() +
    '-' +
    String(new Date(year, numericMonth - 1 + amount, 1).getMonth() + 1).padStart(2, '0')
  );
}

function monthLabel(month: string) {
  const [year, numericMonth] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, numericMonth - 1, 1),
  );
}

function dateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(year, month - 1, day + amount);
  return (
    next.getFullYear() +
    '-' +
    String(next.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(next.getDate()).padStart(2, '0')
  );
}

function statusLabel(status: CalendarDay['status'] | undefined) {
  switch (status) {
    case 'available':
      return 'available';
    case 'sold_out':
      return 'sold out';
    case 'closed':
      return 'closed';
    default:
      return 'unavailable';
  }
}

function statusClass(status: CalendarDay['status'] | undefined) {
  switch (status) {
    case 'available':
      return 'border-success/40 bg-success-surface text-success';
    case 'sold_out':
      return 'border-warning/40 bg-warning-surface text-warning';
    case 'closed':
      return 'border-muted-foreground/30 bg-muted text-muted-foreground';
    default:
      return 'border-border bg-card text-muted-foreground';
  }
}

function isBlocked(
  date: string,
  target: AvailabilityCalendarTarget | null,
  blocks: AvailabilityBlock[],
) {
  if (!target) return false;
  return blocks.some((block) => {
    const applies =
      block.all ||
      (target.kind === 'room-type'
        ? block.roomTypeIds.includes(target.roomType.id)
        : block.roomIds.includes(target.room.id) || block.roomTypeIds.includes(target.roomType.id));
    return applies && block.startsOn <= date && block.endsOn > date;
  });
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
