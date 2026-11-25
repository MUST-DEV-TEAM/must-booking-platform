'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { NumberStepper } from '../../components/ui/number-stepper';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ScopedHotelMoney } from './approximate-money';

type Money = { amount: string; currency: string };
type Offer = { ok: true; total: Money } | { ok: false; reason: string; transient?: boolean };

/** One more room in the same reservation, with its own party and an optional name of who sleeps there. */
export type ExtraRoom = {
  id: string;
  roomTypeId: string;
  adults: number;
  children: number;
  /** One age at check-in for each child, as typed (empty until entered). */
  childrenAges: string[];
  guestFirstName: string;
  guestLastName: string;
};

export function newExtraRoom(roomTypeId = ''): ExtraRoom {
  return {
    id: crypto.randomUUID(),
    roomTypeId,
    adults: 2,
    children: 0,
    childrenAges: [],
    guestFirstName: '',
    guestLastName: '',
  };
}

/**
 * The extra rooms of a multi-room reservation. Every room has the same dates; each is priced and checked for
 * availability with its own party, and the whole reservation is held or refused as one.
 */
export function ExtraRoomsCard({
  base,
  roomTypes,
  startsOn,
  endsOn,
  ratePlanId,
  isClock,
  rooms,
  onChange,
  disabledReason,
}: {
  base: string;
  roomTypes: ReadonlyArray<{ id: string; name: string }>;
  startsOn: string;
  endsOn: string;
  ratePlanId: string;
  isClock: boolean;
  rooms: ExtraRoom[];
  onChange: (rooms: ExtraRoom[]) => void;
  /** Why rooms cannot be added now (for example the stay is not chosen yet). */
  disabledReason?: string | null;
}) {
  const update = (id: string, patch: Partial<ExtraRoom>) =>
    onChange(rooms.map((room) => (room.id === id ? { ...room, ...patch } : room)));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">More rooms in this reservation</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={!!disabledReason}
            onClick={() => onChange([...rooms, newExtraRoom(roomTypes[0]?.id ?? '')])}
          >
            <Plus aria-hidden="true" /> Add another room
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="m-0 text-xs text-muted-foreground">
          {disabledReason ??
            'All rooms share the same dates, are held together (all or none), and are paid and confirmed as one reservation. The hotel’s limit on rooms per booking applies.'}
        </p>
        {rooms.map((room, index) => (
          <ExtraRoomRow
            key={room.id}
            index={index + 2}
            room={room}
            base={base}
            roomTypes={roomTypes}
            startsOn={startsOn}
            endsOn={endsOn}
            ratePlanId={ratePlanId}
            isClock={isClock}
            onChange={(patch) => update(room.id, patch)}
            onRemove={() => onChange(rooms.filter((candidate) => candidate.id !== room.id))}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ExtraRoomRow({
  index,
  room,
  base,
  roomTypes,
  startsOn,
  endsOn,
  ratePlanId,
  isClock,
  onChange,
  onRemove,
}: {
  index: number;
  room: ExtraRoom;
  base: string;
  roomTypes: ReadonlyArray<{ id: string; name: string }>;
  startsOn: string;
  endsOn: string;
  ratePlanId: string;
  isClock: boolean;
  onChange: (patch: Partial<ExtraRoom>) => void;
  onRemove: () => void;
}) {
  const agesReady =
    room.childrenAges.length === room.children &&
    room.childrenAges.every((age) => age.trim() !== '');
  const ready =
    !!startsOn && !!endsOn && !!room.roomTypeId && (isClock || !!ratePlanId) && agesReady;
  const offer = useQuery({
    queryKey: [
      'dashboard',
      'add-reservation-extra-offer',
      base,
      startsOn,
      endsOn,
      ratePlanId,
      isClock,
      room.roomTypeId,
      room.adults,
      room.children,
      room.childrenAges.join(','),
    ],
    enabled: ready,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch(`${base}/staff-bookings/offers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsOn,
          endsOn,
          adults: room.adults,
          children: room.children,
          childrenAges: room.childrenAges.map(Number),
          items: [
            {
              key: room.roomTypeId,
              roomTypeId: room.roomTypeId,
              ratePlanId: isClock ? undefined : ratePlanId,
            },
          ],
        }),
      });
      if (!response.ok) throw new Error('Could not check this room.');
      const body = (await response.json()) as { offers: Record<string, Offer> };
      return body.offers[room.roomTypeId] ?? null;
    },
  });
  const result = offer.data;
  return (
    <div className="space-y-3 rounded-xl border p-4" aria-label={`Room ${index}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">Room {index}</span>
        <div className="flex items-center gap-2">
          {offer.isFetching ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : result?.ok ? (
            <Badge variant="success" className="rounded-full px-2 py-0 text-[11px]">
              Available · <ScopedHotelMoney {...result.total} />
            </Badge>
          ) : result ? (
            <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
              Not available
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove room ${index}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Room type">
          <Select value={room.roomTypeId} onValueChange={(id) => onChange({ roomTypeId: id })}>
            <SelectTrigger aria-label={`Room type for room ${index}`}>
              <SelectValue placeholder="Choose a room type" />
            </SelectTrigger>
            <SelectContent>
              {roomTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Adults">
          <NumberStepper
            label={`Adults in room ${index}`}
            min={1}
            max={20}
            value={room.adults}
            onChange={(adults) => onChange({ adults })}
          />
        </FormField>
        <FormField label="Children">
          <NumberStepper
            label={`Children in room ${index}`}
            min={0}
            max={20}
            value={room.children}
            onChange={(children) =>
              onChange({
                children,
                childrenAges: Array.from(
                  { length: children },
                  (_, n) => room.childrenAges[n] ?? '',
                ),
              })
            }
          />
        </FormField>
      </div>
      {room.children > 0 ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {room.childrenAges.map((age, n) => (
            <FormField key={n} label={`Child ${n + 1} age`}>
              <Input
                type="number"
                min={0}
                max={17}
                value={age}
                aria-label={`Room ${index} child ${n + 1} age at check-in`}
                onChange={(event) =>
                  onChange({
                    childrenAges: room.childrenAges.map((value, m) =>
                      m === n ? event.target.value : value,
                    ),
                  })
                }
              />
            </FormField>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Guest first name (optional)">
          <Input
            value={room.guestFirstName}
            maxLength={100}
            onChange={(event) => onChange({ guestFirstName: event.target.value })}
          />
        </FormField>
        <FormField label="Guest last name (optional)">
          <Input
            value={room.guestLastName}
            maxLength={100}
            onChange={(event) => onChange({ guestLastName: event.target.value })}
          />
        </FormField>
      </div>
      {result && !result.ok ? (
        <p role="status" className="m-0 text-xs text-muted-foreground">
          {result.reason}
        </p>
      ) : null}
    </div>
  );
}
