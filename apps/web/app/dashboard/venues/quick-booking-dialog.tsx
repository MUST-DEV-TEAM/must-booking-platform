'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { DateField } from '../../../components/ui/date-field';
import { DurationField, durationLabel } from '../../../components/ui/duration-field';
import { TimeField } from '../../../components/ui/time-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { NumberStepper } from '../../../components/ui/number-stepper';
import { PhoneInput, parsePhone, phoneToString } from '../../../components/ui/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Stepper } from '../../../components/ui/stepper';
import { CheckoutLinkActions } from '../checkout-link-actions';
import { GuestLookup, type KnownGuest } from '../guest-lookup';
import { reservationApi, type StaffSource } from './reservation-api';
import { SOURCE_OPTIONS } from './reservation-display';
import { venueApi } from './venue-api';

const steps = [
  'Date, guests and time',
  'How long',
  'Area and table',
  'Guest details',
  'Source and deposit',
].map((title, i) => ({ id: String(i), title }));
export function QuickBookingDialog({
  tenantId,
  venueId,
  today,
  initialDate,
  initialTime,
  initialTableId,
  initialAreaId,
  initialPartySize,
  onOpenChange,
}: {
  tenantId: string;
  venueId: string;
  today: string;
  initialDate: string;
  initialTime?: string;
  initialTableId?: string;
  initialAreaId?: string;
  initialPartySize?: number;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState(initialTime ? 1 : 0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const [partySize, setPartySize] = useState(initialPartySize ?? 2);
  const [time, setTime] = useState(initialTime ?? '');
  const [duration, setDuration] = useState<number | null>(null);
  const [areaId, setAreaId] = useState(initialAreaId ?? 'any');
  const [tableId, setTableId] = useState(initialTableId ?? 'best');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState(() => parsePhone(''));
  const [guestEmail, setGuestEmail] = useState('');
  const [guestTerm, setGuestTerm] = useState('');
  const [selectedGuest, setSelectedGuest] = useState<KnownGuest | null>(null);
  const [source, setSource] = useState<StaffSource>('phone');
  const [notes, setNotes] = useState('');
  const [depositAmount, setDepositAmount] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const venue = useQuery({
    queryKey: ['venue', tenantId, venueId],
    queryFn: () => venueApi.getVenue(tenantId, venueId),
  });
  const minutes = duration ?? venue.data?.diningMinutes ?? 90;
  const availability = useQuery({
    queryKey: ['venue-availability', tenantId, venueId, date, partySize, minutes, time],
    queryFn: () =>
      reservationApi.availability(tenantId, venueId, {
        date,
        partySize,
        durationMinutes: minutes,
        ...(time ? { time } : {}),
      }),
  });
  const slots = availability.data?.services.flatMap((s) => s.slots) ?? [];
  const chosen = slots.find((s) => s.time === time && s.bookable);
  const tables = chosen?.freeTables ?? [];
  const available = tables.filter((t) => areaId === 'any' || t.areaId === areaId);
  const effectiveTable =
    tableId === 'best'
      ? (available.find((t) => t.id === chosen?.bestTableId) ??
        [...available].sort(
          (a, b) =>
            a.maxSeats - b.maxSeats ||
            (b.priority ?? 0) - (a.priority ?? 0) ||
            a.label.localeCompare(b.label, undefined, { numeric: true }),
        )[0])
      : available.find((t) => t.id === tableId);
  const base = { date, time, partySize, durationMinutes: minutes, tableId: effectiveTable?.id };
  const quote = useQuery({
    queryKey: ['venue-deposit-quote', tenantId, venueId, base, depositAmount, reason],
    queryFn: () =>
      reservationApi.quote(tenantId, venueId, {
        ...base,
        ...(depositAmount !== null ? { depositAmount, depositOverrideReason: reason } : {}),
      }),
    enabled:
      step === 4 && !!effectiveTable && (depositAmount === null || reason.trim().length >= 3),
  });
  const book = useMutation({
    mutationFn: () =>
      reservationApi.create(tenantId, venueId, {
        ...base,
        requestKey,
        guestName: guestName.trim(),
        guestPhone: phoneToString(guestPhone),
        guestEmail: guestEmail.trim(),
        source,
        notes,
        ...(quote.data ? { depositQuoteHash: quote.data.quoteHash } : {}),
        ...(depositAmount !== null ? { depositAmount, depositOverrideReason: reason } : {}),
      }),
    onSuccess: async (data) => {
      await client.invalidateQueries({ queryKey: ['venue-reservations', tenantId, venueId] });
      await client.invalidateQueries({ queryKey: ['venue-floor', tenantId, venueId] });
      await client.invalidateQueries({ queryKey: ['venue-availability', tenantId, venueId] });
      if (data.status !== 'pending_payment') onOpenChange(false);
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['venue-availability', tenantId, venueId] });
      void client.invalidateQueries({ queryKey: ['venue-deposit-quote', tenantId, venueId] });
    },
  });
  const paymentStatus = useQuery({
    queryKey: ['venue-reservation', tenantId, venueId, book.data?.id],
    queryFn: () => reservationApi.get(tenantId, venueId, book.data!.id),
    enabled: book.data?.status === 'pending_payment',
    refetchInterval: (query) =>
      ['confirmed', 'cancelled'].includes(query.state.data?.status ?? '') ? false : 5000,
  });
  const result = paymentStatus.data ?? book.data;
  const resetChoice = () => {
    setTableId('best');
    setAreaId('any');
    setDepositAmount(null);
    setReason('');
  };
  const canNext =
    step === 0
      ? !!date && slots.some((s) => s.time === time && !s.past)
      : step === 1
        ? !!chosen
        : step === 2
          ? !!effectiveTable
          : !!guestName.trim();
  const departureMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  const departure = `${String(Math.floor(departureMinutes / 60) % 24).padStart(2, '0')}:${String(departureMinutes % 60).padStart(2, '0')}`;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            Choose a table and review the guest's booking terms.
          </DialogDescription>
        </DialogHeader>
        {book.data && result ? (
          <div className="space-y-4">
            <p role="status">
              {result.status === 'confirmed'
                ? `Booking ${result.reference} is confirmed.`
                : result.status === 'cancelled'
                  ? `The hold for ${result.reference} has ended. The table has been released.`
                  : `Booking ${result.reference} is waiting for a deposit until ${result.paymentHoldExpiresAt ? new Date(result.paymentHoldExpiresAt).toLocaleString(undefined, { timeZone: venue.data?.timezone ?? 'UTC' }) : 'the hold expires'}.`}
            </p>
            {result.status === 'pending_payment' &&
            result.paymentHoldExpiresAt &&
            Date.parse(result.paymentHoldExpiresAt) > Date.now() &&
            result.checkout?.state === 'READY' &&
            result.checkout.url ? (
              <CheckoutLinkActions
                url={result.checkout.url}
                tenantId={tenantId}
                propertyId={venue.data?.propertyId ?? ''}
                bookingId={result.id}
                canSend={!!guestEmail.trim()}
                sendPaymentLink={() => reservationApi.sendPaymentLink(tenantId, venueId, result.id)}
              />
            ) : result.status === 'pending_payment' && result.checkout?.state !== 'READY' ? (
              <Alert variant="warning">
                <AlertDescription>
                  The payment link is not verified. Open the booking details for review; do not
                  create another booking.
                </AlertDescription>
              </Alert>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <>
            <Stepper steps={steps} current={step} label="Booking progress" />
            <div className="space-y-4">
              {step === 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Date" htmlFor="booking-date">
                    <DateField
                      id="booking-date"
                      value={date}
                      min={today}
                      onChange={(v) => {
                        setDate(v || today);
                        setTime('');
                        resetChoice();
                      }}
                    />
                  </FormField>
                  <FormField label="Guests">
                    <NumberStepper
                      label="Guests"
                      min={1}
                      max={500}
                      value={partySize}
                      onChange={(v) => {
                        setPartySize(v);
                        resetChoice();
                      }}
                    />
                  </FormField>
                  <FormField
                    label="Arrival time"
                    htmlFor="booking-time"
                    hint="Choose the time on the clock. We check tables for your full stay."
                  >
                    <TimeField
                      id="booking-time"
                      label="Arrival time"
                      value={time}
                      onChange={(value) => {
                        setTime(value);
                        resetChoice();
                      }}
                    />
                  </FormField>
                  <div className="text-sm text-muted-foreground sm:col-span-2">
                    {availability.data?.services.length === 0 ? (
                      <p>The restaurant is closed on this day.</p>
                    ) : (
                      availability.data?.services.map((service) => (
                        <p key={service.name}>
                          {service.name}: {service.opensAt}–{service.closesAt}
                        </p>
                      ))
                    )}
                    {time &&
                    !availability.isFetching &&
                    !slots.some((s) => s.time === time && !s.past) ? (
                      <p role="alert">
                        Choose an arrival time during an open service that has not passed.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {step === 1 ? (
                <FormField
                  label="How long would they like to stay?"
                  hint="Tables must be free for the entire visit. Choose a usual stay or adjust it."
                >
                  <DurationField
                    value={minutes}
                    defaultMinutes={venue.data?.diningMinutes ?? 90}
                    onChange={(v) => {
                      setDuration(v);
                      resetChoice();
                    }}
                  />
                  <p className="mt-3 text-sm">
                    Arrival {time} · Departure {departure}
                    {departureMinutes >= 1440 ? ' next day' : ''} · {durationLabel(minutes)}
                  </p>
                  {!availability.isFetching && !chosen ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      No table is free for this entire stay. Shorten the visit or go back to choose
                      another arrival time.
                    </p>
                  ) : null}
                </FormField>
              ) : null}
              {step === 2 ? (
                <>
                  <FormField label="Dining area">
                    <Select
                      value={areaId}
                      onValueChange={(v) => {
                        setAreaId(v);
                        setTableId('best');
                        setDepositAmount(null);
                      }}
                    >
                      <SelectTrigger aria-label="Dining area">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any area</SelectItem>
                        {[...new Set(tables.map((t) => t.areaId))].map((id) => (
                          <SelectItem key={id} value={id}>
                            {tables.find((t) => t.areaId === id)?.areaName ?? 'Dining area'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Table">
                    <Select
                      value={tableId}
                      onValueChange={(v) => {
                        setTableId(v);
                        setDepositAmount(null);
                      }}
                    >
                      <SelectTrigger aria-label="Table">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="best">Any table - best fit</SelectItem>
                        {available.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.label} - {t.minSeats}-{t.maxSeats} guests
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  {effectiveTable ? (
                    <p className="text-sm text-muted-foreground">
                      Selected: {effectiveTable.label}
                    </p>
                  ) : (
                    <p role="alert">Choose an available table.</p>
                  )}
                </>
              ) : null}
              {step === 3 ? (
                <>
                  <FormField label="Guest name" htmlFor="booking-name" required>
                    <Input
                      id="booking-name"
                      value={guestName}
                      onChange={(e) => {
                        setGuestName(e.target.value);
                        setGuestTerm(e.target.value);
                        setSelectedGuest(null);
                      }}
                    />
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Phone" htmlFor="booking-phone">
                      <PhoneInput
                        id="booking-phone"
                        value={guestPhone}
                        onChange={(value) => {
                          setGuestPhone(value);
                          setGuestTerm(value.number);
                          setSelectedGuest(null);
                        }}
                      />
                    </FormField>
                    <FormField label="Email" htmlFor="booking-email">
                      <Input
                        id="booking-email"
                        type="email"
                        value={guestEmail}
                        onChange={(e) => {
                          setGuestEmail(e.target.value);
                          setGuestTerm(e.target.value);
                          setSelectedGuest(null);
                        }}
                      />
                    </FormField>
                  </div>
                  <GuestLookup
                    tenantId={tenantId}
                    propertyId={venue.data?.propertyId ?? venueId}
                    selected={selectedGuest}
                    searchText={guestTerm}
                    endpoint={`/api/tenants/${tenantId}/venues/${venueId}/guests`}
                    historyNoun="restaurant booking"
                    onClear={() => setSelectedGuest(null)}
                    onPick={(g) => {
                      setSelectedGuest(g);
                      setGuestName([g.firstName, g.lastName].filter(Boolean).join(' ') || g.email);
                      setGuestEmail(g.email);
                      setGuestPhone(parsePhone(g.phone));
                    }}
                  />
                </>
              ) : null}
              {step === 4 ? (
                <>
                  <FormField label="How did they book?" htmlFor="booking-source">
                    <Select value={source} onValueChange={(v) => setSource(v as StaffSource)}>
                      <SelectTrigger id="booking-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Notes" htmlFor="booking-notes">
                    <Input
                      id="booking-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </FormField>
                  {quote.data ? (
                    <>
                      <p>
                        {quote.data.serviceName} - {quote.data.areaName}:{' '}
                        {quote.data.amount === '0.00'
                          ? 'No deposit'
                          : `${quote.data.amount} ${quote.data.currency} deposit, credited toward the bill. Free cancellation until ${quote.data.freeCancelHours} hours before arrival.`}
                      </p>
                    </>
                  ) : null}
                  {quote.data?.canOverride || depositAmount !== null ? (
                    <>
                      <FormField
                        label="Deposit amount"
                        hint="A manager may change or waive the deposit with a reason."
                      >
                        <Input
                          aria-label="Deposit amount"
                          inputMode="decimal"
                          value={depositAmount ?? quote.data?.amount ?? '0.00'}
                          onChange={(e) => setDepositAmount(e.target.value)}
                        />
                      </FormField>
                      {depositAmount !== null ? (
                        <FormField label="Reason for changing the deposit">
                          <Input
                            aria-label="Deposit override reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </FormField>
                      ) : null}
                    </>
                  ) : null}
                  {quote.error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{quote.error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </>
              ) : null}
              {availability.isPending ? <p role="status">Checking availability...</p> : null}
              {availability.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{availability.error.message}</AlertDescription>
                </Alert>
              ) : null}
              {time && !chosen && !availability.isPending ? (
                <Alert variant="warning">
                  <AlertDescription>
                    No table is free for these choices. Go back to choose another time or duration.
                  </AlertDescription>
                </Alert>
              ) : null}
              {book.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{book.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => (step > 0 ? setStep(step - 1) : onOpenChange(false))}
                disabled={book.isPending}
              >
                {step > 0 ? 'Back' : 'Cancel'}
              </Button>
              {step < 4 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={!canNext || availability.isFetching}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  onClick={() => book.mutate()}
                  disabled={
                    !chosen ||
                    !effectiveTable ||
                    !guestName.trim() ||
                    !quote.data ||
                    quote.isFetching ||
                    quote.isError ||
                    book.isPending ||
                    (depositAmount !== null && reason.trim().length < 3)
                  }
                >
                  Book {time}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
