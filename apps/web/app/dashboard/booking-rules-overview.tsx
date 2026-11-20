'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';

import { CalendarPicker, type CalendarSelection } from '../../components/ui/calendar-picker';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { NumberStepper } from '../../components/ui/number-stepper';
import { SegmentedControl } from '../../components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useBookingRulesEvaluation } from './booking-rules';
import { describeBookingRules } from './booking-rules-summary';
import type { Property } from './settings-areas';

const ANY_ROOM = '__any__';
const nightsBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
/** Today on this computer, as YYYY-MM-DD (the server checks again on the hotel's own clock). */
const localToday = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** The rules in plain words, and a box to try a booking against the saved rules. */
export function BookingRulesOverview({
  tenantId,
  property,
}: {
  tenantId: string;
  property: Property;
}) {
  const [dates, setDates] = useState<CalendarSelection>({ start: null, end: null });
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomTypeId, setRoomTypeId] = useState(ANY_ROOM);
  const [viewer, setViewer] = useState<'guest' | 'staff'>('guest');
  const startsOn = dates.start ?? '';
  const endsOn = dates.end ?? '';
  const ready = Boolean(startsOn && endsOn && endsOn > startsOn);
  const nights = ready ? nightsBetween(startsOn, endsOn) : 0;
  const roomTypes = useQuery({
    queryKey: ['dashboard', 'booking-rules-room-types', tenantId, property.id],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${property.id}/room-types`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) return [] as Array<{ id: string; name: string }>;
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as Array<{ id: string; name: string }>) : [];
    },
    staleTime: 60_000,
  });
  const check = useBookingRulesEvaluation(
    tenantId,
    property.id,
    {
      channel: viewer,
      startsOn,
      endsOn,
      adults,
      children,
      roomTypeId: roomTypeId === ANY_ROOM ? undefined : roomTypeId,
    },
    ready,
  );
  const result = ready ? check.data?.booking : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormSection
          title="Your rules in short"
          description="What guests are told, from the saved settings."
        >
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {describeBookingRules(property).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </FormSection>
        <FormSection
          title="Try a booking"
          description="Pick the stay and the guests to see whether the saved rules allow it. Choose a room type to check availability and room size too. Reception can override the hotel's own limits with a reason."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField className="sm:col-span-2" label="Check as">
              <SegmentedControl
                label="Check as"
                value={viewer}
                onChange={setViewer}
                options={[
                  { value: 'guest', label: 'A guest' },
                  { value: 'staff', label: 'Reception' },
                ]}
              />
            </FormField>
            <FormField
              className="sm:col-span-2"
              label="Stay dates"
              hint={
                nights > 0
                  ? `${nights} night${nights === 1 ? '' : 's'}`
                  : 'Pick check-in and check-out.'
              }
            >
              <CalendarPicker
                label="Stay dates"
                mode="range"
                months={2}
                minDate={localToday()}
                value={dates}
                onChange={setDates}
                className="w-full justify-between"
              />
            </FormField>
            <FormField label="Adults">
              <NumberStepper label="Adults" value={adults} min={1} max={50} onChange={setAdults} />
            </FormField>
            <FormField label="Children">
              <NumberStepper
                label="Children"
                value={children}
                min={0}
                max={50}
                onChange={setChildren}
              />
            </FormField>
            <FormField className="sm:col-span-2" label="Room type">
              <Select value={roomTypeId} onValueChange={setRoomTypeId}>
                <SelectTrigger aria-label="Room type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_ROOM}>Any room type (rules only)</SelectItem>
                  {(roomTypes.data ?? []).map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div role="status" aria-live="polite" className="text-sm">
            {!ready ? (
              <p className="m-0 text-muted-foreground">Choose a check-in and a check-out date.</p>
            ) : check.isPending ? (
              <p className="m-0 text-muted-foreground">Checking…</p>
            ) : check.isError ? (
              <p className="m-0 text-destructive">The rules could not be checked. Try again.</p>
            ) : result?.valid ? (
              <p className="m-0 flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 aria-hidden="true" className="size-4" /> Allowed. A guest could book
                this.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="m-0 flex items-center gap-2 font-semibold text-destructive">
                  <XCircle aria-hidden="true" className="size-4" /> Not allowed
                </p>
                <ul className="m-0 list-disc pl-5">
                  {(result?.errors ?? []).map((error) => (
                    <li key={error.code}>
                      {error.message}
                      {error.overridable ? (
                        <span className="text-muted-foreground"> (reception can override)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </FormSection>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        These are the rules for the whole hotel. Dates and rates with their own limits are set in{' '}
        <a
          className="font-semibold text-foreground underline"
          href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(property.id)}&section=rates-pricing`}
        >
          Rates &amp; Pricing
        </a>
        .
      </p>
    </div>
  );
}
