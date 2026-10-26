'use client';
import { CountrySelect } from '../../components/ui/country-select';

import { useBookingRulesEvaluation } from './booking-rules';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CircleCheck,
  CreditCard,
  Loader2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ActionBar } from '../../components/ui/action-bar';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  CalendarPicker,
  formatCalendarSelection,
  type CalendarSelection,
} from '../../components/ui/calendar-picker';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailList, SectionLabel } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Checkbox } from '../../components/ui/checkbox';
import { Input, Textarea } from '../../components/ui/input';
import {
  parsePhone,
  PhoneInput,
  phoneToString,
  type PhoneValue,
} from '../../components/ui/phone-input';
import { TimeField } from '../../components/ui/time-field';
import { TabBar } from '../../components/ui/tab-bar';
import { NumberStepper } from '../../components/ui/number-stepper';
import { OptionCard } from '../../components/ui/option-card';
import { PageHero } from '../../components/ui/page-hero';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { EmptyPanel } from '../../components/ui/state-panel';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Stepper } from '../../components/ui/stepper';
import { findDialCountry } from '../../lib/dial-codes';
import {
  cleanAddress,
  cleanEmail,
  cleanName,
  cleanPostcode,
  emailError,
  LIMITS,
  nameError,
  phoneError,
} from '../../lib/input-rules';
import { nightsBetween } from '../../lib/reservation-display';
import { AwaitingPayment } from './awaiting-payment';
import { GuestLookup, type KnownGuest } from './guest-lookup';

type RoomType = { id: string; name: string; roomCount: number };
type Room = { id: string; name: string; roomTypeId: string; roomTypeName: string };
type RatePlan = { id: string; name: string; currency: string };
type Money = { amount: string; currency: string };
type Offer = { ok: true; total: Money } | { ok: false; reason: string; transient?: boolean };
type AppliedPromo = { code: string; discount: Money; originalTotal: Money; source: string };
type RateOffer = { rateId: string; name: string; label: string; mealNames: string[]; total: Money };
type Guest = {
  firstName: string;
  lastName: string;
  email: string;
  phone: PhoneValue;
  streetAddress: string;
  addressLine2: string;
  city: string;
  county: string;
  postcode: string;
  countryCode?: string | null;
  arrivalTime: string;
  accessibility: boolean;
  specialRequests: string;
};
type GatewayMethod = 'pay_at_hotel' | 'stripe' | 'pokpay';
type SettleMethod = '' | 'cash' | 'card_in_person' | 'bank_transfer';
type PaymentGateways = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
type Created = {
  id: string;
  reference: string;
  outcome: 'checkout' | 'settled' | 'pay-at-hotel';
  checkoutUrl?: string;
  checkoutOrderId?: string;
  gateway?: GatewayMethod;
};

const steps = [
  { id: 'stay', title: 'Stay details', description: 'Dates, guests and room' },
  { id: 'guest', title: 'Guest information', description: 'Who is staying' },
  { id: 'payment', title: 'Payment & review', description: 'Settle and confirm' },
] as const;

const emptyGuest: Guest = {
  firstName: '',
  lastName: '',
  email: '',
  phone: { iso: 'AL', number: '' },
  streetAddress: '',
  addressLine2: '',
  city: '',
  county: '',
  postcode: '',
  countryCode: undefined,
  arrivalTime: '',
  accessibility: false,
  specialRequests: '',
};

/** Structured choices become short lines at the top of the reservation's special requests. */
function requestsText(guest: Guest): string | undefined {
  const lines = [
    guest.arrivalTime ? `Arrival around ${guest.arrivalTime}` : '',
    guest.accessibility ? 'Needs an accessible room' : '',
    guest.specialRequests.trim(),
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}
const gatewayLabels: Record<GatewayMethod, { title: string; description: string }> = {
  pay_at_hotel: {
    title: 'Pay at hotel',
    description: 'The reservation is confirmed now; the guest pays at the desk.',
  },
  stripe: {
    title: 'Card payment (Stripe)',
    description: 'A payment window opens; the reservation confirms once the guest pays.',
  },
  pokpay: {
    title: 'Card payment (PokPay)',
    description: 'Pay, send or copy a link, or show a QR code after creating the reservation.',
  },
};

const money = (value: Money) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency }).format(
    Number(value.amount),
  );
const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

function href(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

/**
 * Staff create a reservation in three steps: stay details (dates, guests, room type), guest
 * information, then payment and review. The same flow serves "Add reservation" and the
 * Overview's Quick booking tab. One room per reservation for now; several rooms in one
 * reservation is a planned addition (Milestone 24, G14).
 */
export function AddReservation({
  tenantId,
  propertyId,
  bookingMode,
  paymentGateways,
  checkInTime,
  canRecordPayment = false,
  canCheckPayment = false,
  canViewBooking = false,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
  paymentGateways?: PaymentGateways;
  /** The hotel's check-in time ("HH:MM"); the arrival time starts here and can be changed. */
  checkInTime?: string | null;
  canRecordPayment?: boolean;
  canCheckPayment?: boolean;
  canViewBooking?: boolean;
}) {
  const hotelCheckIn = /^\d{2}:\d{2}/.test(checkInTime ?? '') ? checkInTime!.slice(0, 5) : '';
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [step, setStep] = useState(0);
  // The calendar can send people here with a day (and a room) already chosen.
  const prefill =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const prefillStart = prefill?.get('start') ?? '';
  const prefillEnd = prefill?.get('end') ?? '';
  const [dates, setDates] = useState<CalendarSelection>(() =>
    /^\d{4}-\d{2}-\d{2}$/.test(prefillStart) && /^\d{4}-\d{2}-\d{2}$/.test(prefillEnd)
      ? { start: prefillStart, end: prefillEnd }
      : { start: null, end: null },
  );
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childrenAges, setChildrenAges] = useState<string[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [clockRateId, setClockRateId] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promoState, setPromoState] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'applied'; code: string; promo: AppliedPromo; total: Money; forKey: string }
    | { status: 'refused'; message: string }
  >({ status: 'idle' });
  const [roomTypeId, setRoomTypeId] = useState(() => prefill?.get('roomTypeId') ?? '');
  const [roomId, setRoomId] = useState(() => prefill?.get('roomId') ?? '');
  const [chooseBy, setChooseBy] = useState<'type' | 'room'>(
    bookingMode === 'INDIVIDUAL_ROOM_ONLY' || (bookingMode === 'MIXED' && prefill?.get('roomId'))
      ? 'room'
      : 'type',
  );
  const [guest, setGuest] = useState<Guest>({ ...emptyGuest, arrivalTime: hotelCheckIn });
  const [touched, setTouched] = useState(false);
  const [knownGuest, setKnownGuest] = useState<KnownGuest | null>(null);
  const [gateway, setGateway] = useState<GatewayMethod | ''>('');
  const [settle, setSettle] = useState<SettleMethod>('');
  const [created, setCreated] = useState<Created | null>(null);
  // One key per distinct request: a retry of the same request cannot create a second reservation,
  // while a changed request gets a fresh key.
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  // The payment window is opened the moment the button is clicked (browsers only allow that
  // from a click) and pointed at the checkout once it exists. A window this page opened itself
  // is also one the payment-complete page is allowed to close.
  const payWindow = useRef<Window | null>(null);

  const statusQuery = useQuery({
    queryKey: ['dashboard', 'add-reservation-pms', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/pms-connection-status`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to determine the PMS connection.');
      return (await response.json()) as { provider: 'CLOCK_PMS' | 'LOCAL' };
    },
  });
  const isClock = statusQuery.data?.provider === 'CLOCK_PMS';

  const catalogQuery = useQuery({
    queryKey: ['dashboard', 'add-reservation-catalog', tenantId, propertyId],
    queryFn: async () => {
      const [roomTypesResponse, roomsResponse, ratesResponse] = await Promise.all([
        fetch(`${base}/room-types`, { credentials: 'include' }),
        fetch(`${base}/rooms`, { credentials: 'include' }),
        fetch(`${base}/rate-plans`, { credentials: 'include' }),
      ]);
      if (!roomTypesResponse.ok || !roomsResponse.ok || !ratesResponse.ok)
        throw new Error('Unable to load rooms and rates.');
      const [roomTypes, rooms, rates] = (await Promise.all([
        roomTypesResponse.json(),
        roomsResponse.json(),
        ratesResponse.json(),
      ])) as [RoomType[], Room[], RatePlan[]];
      // Room types with no rooms cannot be booked.
      return { roomTypes: roomTypes.filter((type) => type.roomCount > 0), rooms, rates };
    },
  });
  const roomTypes = catalogQuery.data?.roomTypes ?? [];
  const rooms = catalogQuery.data?.rooms ?? [];
  const rates = catalogQuery.data?.rates ?? [];

  useEffect(() => {
    // A local hotel needs a rate plan; start with the only one if there is just one.
    if (!isClock && !ratePlanId && rates.length === 1) setRatePlanId(rates[0]!.id);
  }, [isClock, rates, ratePlanId]);
  useEffect(() => {
    if (!gateway && paymentGateways) {
      setGateway(
        paymentGateways.payAtHotel
          ? 'pay_at_hotel'
          : paymentGateways.stripe
            ? 'stripe'
            : paymentGateways.pokpay
              ? 'pokpay'
              : '',
      );
    }
  }, [gateway, paymentGateways]);

  const startsOn = dates.start ?? '';
  const endsOn = dates.end ?? '';
  const nights = startsOn && endsOn ? nightsBetween(startsOn, endsOn) : 0;
  const stayRules = useBookingRulesEvaluation(tenantId, propertyId, {
    startsOn,
    endsOn,
    roomTypeId,
    roomId: roomId || undefined,
    adults,
    children,
  });
  const stayRuleError = stayRules.data?.booking.errors[0]?.message;
  const stayReady =
    Boolean(stayRules.data?.booking.valid) &&
    adults >= 1 &&
    childrenAges.length === children &&
    childrenAges.every(
      (age) =>
        age !== '' && Number.isInteger(Number(age)) && Number(age) >= 0 && Number(age) <= 120,
    ) &&
    (isClock || !!ratePlanId) &&
    roomTypes.length > 0;
  const showRoomPick = bookingMode === 'INDIVIDUAL_ROOM_ONLY' || bookingMode === 'MIXED';
  const mustPickRoom = bookingMode === 'INDIVIDUAL_ROOM_ONLY';
  // Hotels that book specific rooms list rooms; mixed hotels can switch between the two views.
  const byRoom =
    bookingMode === 'INDIVIDUAL_ROOM_ONLY' || (bookingMode === 'MIXED' && chooseBy === 'room');
  const bookableRooms = rooms.filter((room) =>
    roomTypes.some((type) => type.id === room.roomTypeId),
  );

  // Search every room type for the chosen stay once the form is complete.
  const [searchKey, setSearchKey] = useState('');
  const currentKey = stayReady
    ? `${startsOn}|${endsOn}|${adults}|${children}|${childrenAges.join(',')}|${ratePlanId}|${isClock}`
    : '';
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchKey(currentKey), 400);
    return () => window.clearTimeout(timer);
  }, [currentKey]);

  const [checkIndividual, setCheckIndividual] = useState(false);
  const loadOffers = async (items: Array<{ key: string; roomTypeId: string; roomId?: string }>) => {
    const result = (await post(`${base}/staff-bookings/offers`, {
      startsOn,
      endsOn,
      adults,
      children,
      childrenAges: childrenAges.map(Number),
      items: items.map((i) => ({ ...i, ratePlanId: isClock ? undefined : ratePlanId })),
    })) as { offers: Record<string, Offer> };
    return result.offers;
  };
  const typeOffers = useQuery({
    queryKey: ['dashboard', 'add-reservation-type-offers', tenantId, propertyId, searchKey],
    enabled: searchKey !== '' && searchKey === currentKey,
    queryFn: () => loadOffers(roomTypes.map((t) => ({ key: t.id, roomTypeId: t.id }))),
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const roomOffers = useQuery({
    queryKey: [
      'dashboard',
      'add-reservation-room-offers',
      tenantId,
      propertyId,
      searchKey,
      roomTypeId,
    ],
    enabled:
      searchKey !== '' &&
      searchKey === currentKey &&
      !!roomTypeId &&
      (byRoom || checkIndividual || !!roomId),
    queryFn: () =>
      loadOffers(
        bookableRooms
          .filter((r) => r.roomTypeId === roomTypeId)
          .map((r) => ({ key: r.id, roomTypeId: r.roomTypeId, roomId: r.id })),
      ),
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const offers: Record<string, Offer> = { ...typeOffers.data, ...roomOffers.data };
  const searching =
    stayReady && (searchKey !== currentKey || typeOffers.isFetching || roomOffers.isFetching);
  const selectedType = roomTypes.find((type) => type.id === roomTypeId) ?? null;
  const selectedOffer = byRoom
    ? roomId
      ? offers[roomId]
      : undefined
    : roomId
      ? offers[roomId]
      : roomTypeId
        ? offers[roomTypeId]
        : undefined;
  // A Clock hotel can sell the same room under several rates (for example Bed & breakfast or
  // Full board). The first rate is the default; the picker only appears when there is a choice.
  const rateOffersQuery = useQuery({
    queryKey: [
      'dashboard',
      'add-reservation-rate-offers',
      tenantId,
      propertyId,
      searchKey,
      roomTypeId,
    ],
    enabled: isClock && searchKey !== '' && searchKey === currentKey && !!roomTypeId,
    queryFn: async () =>
      (
        (await post(`${base}/staff-bookings/rate-offers`, {
          roomTypeId,
          startsOn,
          endsOn,
          adults,
          children,
          childrenAges: childrenAges.map(Number),
        })) as { offers: RateOffer[] }
      ).offers,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const rateOptions = rateOffersQuery.data ?? [];
  const rateChoice = rateOptions.length > 1;
  // Every rate is shown and can be chosen. Until one is, the lowest price is selected: the same price the
  // room card advertises as "from", never a rate picked by a stored priority.
  const lowestRate = rateOptions.reduce<RateOffer | undefined>(
    (best, option) =>
      !best || Number(option.total.amount) < Number(best.total.amount) ? option : best,
    undefined,
  );
  const chosenRate = rateChoice
    ? (rateOptions.find((option) => option.rateId === clockRateId) ?? lowestRate!)
    : null;
  const baseTotal = searchKey === currentKey && selectedOffer?.ok ? selectedOffer.total : null;
  const rateTotal = baseTotal && chosenRate ? chosenRate.total : baseTotal;
  // A code that was checked for exactly this stay replaces the price; any change to the stay clears it.
  const stayKey = [startsOn, endsOn, adults, children, roomTypeId, chosenRate?.rateId ?? ''].join(
    '|',
  );
  const appliedPromo =
    promoState.status === 'applied' && promoState.forKey === stayKey ? promoState : null;
  const total = appliedPromo ? appliedPromo.total : rateTotal;
  const roomOptions = rooms.filter((room) => room.roomTypeId === roomTypeId);
  const selectedRoom = rooms.find((room) => room.id === roomId) ?? null;

  const stayComplete =
    !!total &&
    !stayRules.isFetching &&
    !stayRules.isPlaceholderData &&
    !!stayRules.data?.booking.valid &&
    (!byRoom || !!roomId);
  const guestErrors = {
    firstName: nameError(guest.firstName, 'first name'),
    lastName: nameError(guest.lastName, 'last name'),
    email: emailError(guest.email),
    phone: phoneError(
      guest.phone.number,
      (findDialCountry(guest.phone.iso)?.prefix ?? '').replace('+', '').length,
    ),
  };
  const guestComplete = Object.values(guestErrors).every((error) => !error);
  // Problems show once a field has been left, or after trying to continue.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const leave = (field: string) => setLeft((current) => new Set(current).add(field));
  const shown = (field: keyof typeof guestErrors) =>
    touched || left.has(field) ? guestErrors[field] : null;

  const checkPromo = async () => {
    setPromoState({ status: 'checking' });
    try {
      const result = (await post(`${base}/staff-bookings/promo-check`, {
        roomTypeId,
        roomId: showRoomPick && roomId ? roomId : undefined,
        clockRateId: chosenRate?.rateId,
        promoCode: promoInput,
        startsOn,
        endsOn,
        adults,
        children,
        childrenAges: childrenAges.map(Number),
      })) as { total: Money; promo: AppliedPromo | null };
      if (!result.promo) throw new Error('This code is not valid for this stay.');
      setPromoState({
        status: 'applied',
        code: result.promo.code,
        promo: result.promo,
        total: result.total,
        forKey: stayKey,
      });
    } catch (error) {
      setPromoState({
        status: 'refused',
        message: errorMessage(error),
      });
    }
  };

  const create = useMutation({
    mutationFn: async (): Promise<Created> => {
      const payload = {
        roomTypeId,
        roomId: showRoomPick && roomId ? roomId : undefined,
        ratePlanId: isClock ? undefined : ratePlanId,
        clockRateId: chosenRate?.rateId,
        promoCode: appliedPromo?.code,
        startsOn,
        endsOn,
        adults,
        children,
        childrenAges: childrenAges.map(Number),
        guest: {
          firstName: guest.firstName.trim(),
          lastName: guest.lastName.trim(),
          email: guest.email.trim(),
          phone: phoneToString(guest.phone) || undefined,
          streetAddress: guest.streetAddress.trim() || undefined,
          addressLine2: guest.addressLine2.trim() || undefined,
          city: guest.city.trim() || undefined,
          county: guest.county.trim() || undefined,
          postcode: guest.postcode.trim() || undefined,
          countryCode: guest.countryCode,
          specialRequests: requestsText(guest),
        },
        paymentMethod: gateway,
      };
      const signature = JSON.stringify(payload);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const result = await post(`${base}/staff-bookings`, payload, attempt.current.key);
      if (!result.ok) throw new Error(result.error?.message ?? 'Unable to create the reservation.');
      const id = String(result.value.id);
      const reference = String(result.value.externalReference ?? id);
      if (result.value.checkoutUrl) {
        const url = String(result.value.checkoutUrl);
        if (payWindow.current && !payWindow.current.closed) payWindow.current.location.href = url;
        else if (gateway !== 'pokpay') {
          const fallback = window.open(url, '_blank');
          if (fallback) fallback.opener = null;
        }
        payWindow.current = null;
        return {
          id,
          reference,
          outcome: 'checkout',
          checkoutUrl: String(result.value.checkoutUrl),
          checkoutOrderId:
            typeof result.value.checkoutOrderId === 'string'
              ? result.value.checkoutOrderId
              : undefined,
          gateway: gateway || undefined,
        };
      }
      if (settle) {
        const paid = await post(
          `${base}/bookings/${id}/manual-payment`,
          { method: settle },
          crypto.randomUUID(),
        );
        if (!paid.ok)
          throw new Error(
            paid.error?.message ?? 'Reservation created, but the payment could not be recorded.',
          );
        return { id, reference, outcome: 'settled' };
      }
      return { id, reference, outcome: 'pay-at-hotel' };
    },
    onSuccess: (result) => setCreated(result),
    onError: () => {
      payWindow.current?.close();
      payWindow.current = null;
    },
  });

  const reset = () => {
    setStep(0);
    setDates({ start: null, end: null });
    setChildren(0);
    setChildrenAges([]);
    setRoomTypeId('');
    setRoomId('');
    setGuest({ ...emptyGuest, arrivalTime: hotelCheckIn });
    setSettle('');
    setTouched(false);
    setKnownGuest(null);
    setLeft(new Set());
    setCreated(null);
    attempt.current = null;
    create.reset();
  };

  const hero = (
    <PageHero
      eyebrow="Staff booking workspace"
      title="Add reservation"
      description="Find a room, add the guest, and settle the stay."
      actions={
        <Button variant="outline" asChild>
          <a href={href(tenantId, propertyId, 'section=calendar')}>
            <CalendarDays aria-hidden="true" /> Open calendar
          </a>
        </Button>
      }
    />
  );

  if (catalogQuery.isError)
    return (
      <div className="space-y-4">
        {hero}
        <Alert variant="destructive">
          <AlertTitle>Rooms and rates could not be loaded</AlertTitle>
          <AlertDescription>
            {catalogQuery.error instanceof Error
              ? catalogQuery.error.message
              : 'Try again in a moment.'}
          </AlertDescription>
        </Alert>
      </div>
    );

  if (created?.outcome === 'checkout') {
    return (
      <div className="space-y-4">
        {hero}
        <AwaitingPayment
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={created.id}
          reference={created.reference}
          checkoutUrl={created.checkoutUrl}
          checkoutOrderId={created.checkoutOrderId}
          providerName={created.gateway === 'stripe' ? 'Stripe' : 'PokPay'}
          reservationHref={href(
            tenantId,
            propertyId,
            `section=reservations&reservation=${created.id}`,
          )}
          canSendPaymentLink={canRecordPayment}
          canCheckPayment={canCheckPayment}
          canViewBooking={canViewBooking}
          onStartOver={reset}
        />
      </div>
    );
  }

  if (created) {
    const messages: Record<Created['outcome'], string> = {
      checkout:
        'Complete the payment in the new window. The reservation confirms automatically once it is paid.',
      settled: 'The reservation is confirmed and the payment is recorded.',
      'pay-at-hotel': 'The reservation is confirmed. The guest pays at the hotel.',
    };
    return (
      <div className="space-y-4">
        {hero}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-surface text-success">
              <CircleCheck aria-hidden="true" className="size-6" />
            </span>
            <h3 className="m-0 text-xl font-extrabold">Reservation created</h3>
            <p className="m-0 max-w-md text-sm text-muted-foreground">
              {created.reference} · {guest.firstName} {guest.lastName}. {messages[created.outcome]}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <a
                  href={href(
                    tenantId,
                    propertyId,
                    `section=reservations&reservation=${created.id}`,
                  )}
                >
                  Open reservation <ArrowRight aria-hidden="true" />
                </a>
              </Button>
              <Button variant="outline" onClick={reset}>
                Add another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = (
    <Card className="lg:sticky lg:top-[calc(var(--app-header-height,68px)+1rem)]">
      <CardHeader>
        <CardTitle className="text-base">Booking summary</CardTitle>
        <p className="m-0 text-xs text-muted-foreground">Your current selection.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <DetailList
          items={[
            {
              label: 'Dates',
              value: startsOn && endsOn ? formatCalendarSelection(dates, 'range') : null,
            },
            {
              label: 'Length',
              value: nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : null,
            },
            {
              label: 'Guests',
              value: `${adults} adult${adults === 1 ? '' : 's'}${children ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`,
            },
            { label: 'Room type', value: selectedType?.name },
            ...(chosenRate ? [{ label: 'Rate', value: chosenRate.label }] : []),
            ...(appliedPromo
              ? [
                  { label: 'Promo code', value: appliedPromo.code },
                  {
                    label: 'Discount',
                    value: `-${money(appliedPromo.promo.discount)}`,
                  },
                ]
              : []),
            {
              label: 'Room',
              value: selectedRoom?.name ?? (selectedType && showRoomPick ? 'Auto-assign' : null),
            },
            {
              label: 'Guest',
              value:
                guest.firstName || guest.lastName
                  ? `${guest.firstName} ${guest.lastName}`.trim()
                  : null,
            },
          ]}
        />
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-semibold">Estimated total</span>
          <span className="text-lg font-extrabold">{total ? money(total) : '—'}</span>
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          Availability and price are checked again when the reservation is created.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {hero}
      <Stepper steps={steps} current={step} label="Reservation steps" />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {step === 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Search availability</CardTitle>
                  <p className="m-0 text-xs text-muted-foreground">
                    Set the stay and the guests to find matching room types.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      className="sm:col-span-2"
                      label="Stay dates"
                      required
                      error={stayRuleError ?? (stayRules.isError ? stayRules.error.message : null)}
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
                        minDate={stayRules.data?.today}
                        value={dates}
                        onChange={(next) => {
                          setDates(next);
                          setRoomId('');
                        }}
                        className="w-full justify-between"
                      />
                    </FormField>
                    {!isClock ? (
                      <FormField label="Rate plan" required>
                        <Select value={ratePlanId} onValueChange={setRatePlanId}>
                          <SelectTrigger aria-label="Rate plan">
                            <SelectValue placeholder="Select a rate plan" />
                          </SelectTrigger>
                          <SelectContent>
                            {rates.map((rate) => (
                              <SelectItem key={rate.id} value={rate.id}>
                                {rate.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    ) : null}
                    <FormField label="Adults" required>
                      <NumberStepper
                        label="Adults"
                        min={1}
                        max={20}
                        value={adults}
                        onChange={setAdults}
                      />
                    </FormField>
                    <FormField label="Children">
                      <NumberStepper
                        label="Children"
                        min={0}
                        max={20}
                        value={children}
                        onChange={(n) => {
                          setChildren(n);
                          setChildrenAges((old) =>
                            Array.from({ length: n }, (_, i) => old[i] ?? ''),
                          );
                        }}
                      />
                    </FormField>
                    {childrenAges.map((age, i) => (
                      <FormField key={i} label={`Child ${i + 1} age at check-in`} required>
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={age}
                          aria-label={`Child ${i + 1} age at check-in`}
                          onChange={(e) =>
                            setChildrenAges((old) =>
                              old.map((v, n) => (n === i ? e.target.value : v)),
                            )
                          }
                        />
                      </FormField>
                    ))}
                  </div>
                  <p className="m-0 text-xs text-muted-foreground">
                    One room per reservation. For several rooms, create one reservation for each.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Available rooms</CardTitle>
                    {!searching &&
                    Object.values(offers).some((offer) => !offer.ok && offer.transient) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void Promise.all([
                            typeOffers.refetch(),
                            ...(roomTypeId && (byRoom || checkIndividual)
                              ? [roomOffers.refetch()]
                              : []),
                          ])
                        }
                      >
                        Check again
                      </Button>
                    ) : searching ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> Checking…
                      </span>
                    ) : stayReady && Object.keys(offers).length > 0 ? (
                      <Badge variant="success" className="rounded-full px-2 py-0 text-[11px]">
                        {Object.values(offers).filter((offer) => offer.ok).length} match
                        {Object.values(offers).filter((offer) => offer.ok).length === 1 ? '' : 'es'}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent>
                  {bookingMode === 'MIXED' ? (
                    <div className="mb-3">
                      <TabBar
                        label="Choose by"
                        current={chooseBy}
                        onSelect={(id) => {
                          setChooseBy(id as 'type' | 'room');
                          setRoomId('');
                        }}
                        tabs={[
                          { id: 'type', label: 'By room type' },
                          { id: 'room', label: 'By specific room' },
                        ]}
                      />
                    </div>
                  ) : null}
                  {typeOffers.error || roomOffers.error ? (
                    <div role="alert" className="space-y-2">
                      <p>
                        Rooms could not be checked.{' '}
                        {errorMessage(typeOffers.error || roomOffers.error)}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          void typeOffers.refetch();
                          if (byRoom && checkIndividual) void roomOffers.refetch();
                        }}
                      >
                        Retry availability
                      </Button>
                    </div>
                  ) : null}
                  {!stayReady ? (
                    <EmptyPanel
                      title="Choose dates to see rooms"
                      description={
                        !isClock && !ratePlanId
                          ? 'Pick the stay dates and a rate plan.'
                          : 'Pick check-in and check-out, then the matching rooms appear here.'
                      }
                    />
                  ) : byRoom ? (
                    <div role="radiogroup" aria-label="Rooms" className="space-y-5">
                      <Select
                        value={roomTypeId}
                        onValueChange={(id) => {
                          setRoomTypeId(id);
                          setRoomId('');
                        }}
                      >
                        <SelectTrigger aria-label="Room type for individual rooms">
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
                      {roomTypes
                        .filter((type) => type.id === roomTypeId)
                        .map((type) => {
                          const typeRooms = bookableRooms.filter(
                            (room) => room.roomTypeId === type.id,
                          );
                          if (typeRooms.length === 0) return null;
                          return (
                            <div key={type.id} className="space-y-2">
                              <SectionLabel>{type.name}</SectionLabel>
                              {typeRooms.map((room) => {
                                const offer = offers[room.id];
                                const ok = offer?.ok === true;
                                return (
                                  <OptionCard
                                    key={room.id}
                                    title={room.name}
                                    badges={
                                      <Badge
                                        variant="secondary"
                                        className="rounded-full px-2 py-0 text-[10px]"
                                      >
                                        {type.name}
                                      </Badge>
                                    }
                                    description={
                                      offer && !offer.ok
                                        ? offer.reason
                                        : `${nights} night${nights === 1 ? '' : 's'}`
                                    }
                                    aside={
                                      ok ? (
                                        <span className="block text-base font-extrabold">
                                          {money(offer.total)}
                                        </span>
                                      ) : offer ? (
                                        <Badge
                                          variant="muted"
                                          className="rounded-full px-2 py-0 text-[10px]"
                                        >
                                          {offer && !offer.ok && offer.transient
                                            ? 'Busy'
                                            : 'Not available'}
                                        </Badge>
                                      ) : null
                                    }
                                    selected={roomId === room.id}
                                    disabled={!ok}
                                    onSelect={() => {
                                      setRoomTypeId(room.roomTypeId);
                                      setRoomId(room.id);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div role="radiogroup" aria-label="Room types" className="space-y-3">
                      {roomTypes.map((type) => {
                        const offer = offers[type.id];
                        const ok = offer?.ok === true;
                        return (
                          <OptionCard
                            key={type.id}
                            title={type.name}
                            badges={
                              <Badge
                                variant="secondary"
                                className="rounded-full px-2 py-0 text-[10px]"
                              >
                                {type.roomCount} room{type.roomCount === 1 ? '' : 's'} total
                              </Badge>
                            }
                            description={
                              offer && !offer.ok
                                ? offer.reason
                                : `${nights} night${nights === 1 ? '' : 's'} · ${adults} adult${adults === 1 ? '' : 's'}${children ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`
                            }
                            aside={
                              ok ? (
                                <span className="block">
                                  <span className="block text-base font-extrabold">
                                    {money(offer.total)}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    for the stay
                                  </span>
                                </span>
                              ) : offer ? (
                                <Badge
                                  variant="muted"
                                  className="rounded-full px-2 py-0 text-[10px]"
                                >
                                  {offer && !offer.ok && offer.transient ? 'Busy' : 'Not available'}
                                </Badge>
                              ) : null
                            }
                            selected={roomTypeId === type.id}
                            disabled={!ok}
                            onSelect={() => {
                              setRoomTypeId(type.id);
                              setRoomId('');
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                  {selectedType && showRoomPick && !byRoom ? (
                    <div className="mt-4 max-w-sm">
                      <FormField
                        label="Individual room"
                        required={mustPickRoom}
                        hint={
                          mustPickRoom
                            ? 'This hotel books specific rooms.'
                            : 'Leave on auto-assign to let the hotel choose.'
                        }
                      >
                        <Select
                          onOpenChange={(open) => {
                            if (open) setCheckIndividual(true);
                          }}
                          value={roomId || (mustPickRoom ? '' : 'auto')}
                          onValueChange={(value) => setRoomId(value === 'auto' ? '' : value)}
                        >
                          <SelectTrigger aria-label="Individual room">
                            <SelectValue placeholder="Select a room" />
                          </SelectTrigger>
                          <SelectContent>
                            {mustPickRoom ? null : (
                              <SelectItem value="auto">Auto-assign</SelectItem>
                            )}
                            {roomOptions.map((room) => (
                              <SelectItem
                                key={room.id}
                                value={room.id}
                                disabled={!offers[room.id]?.ok}
                              >
                                {room.name}
                                {!offers[room.id]
                                  ? ' ? Checking?'
                                  : !offers[room.id]?.ok
                                    ? ' ? Not available'
                                    : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              {chosenRate ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Rate</CardTitle>
                    <p className="m-0 text-xs text-muted-foreground">
                      This room is sold under more than one rate for these dates. The lowest price
                      is selected; choose another if the guest prefers.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div role="radiogroup" aria-label="Rates" className="space-y-3">
                      {rateOptions.map((option) => (
                        <OptionCard
                          key={option.rateId}
                          title={option.label}
                          description={`${
                            rateOptions.filter((other) => other.label === option.label).length > 1
                              ? `${option.name} · `
                              : ''
                          }${nights} night${nights === 1 ? '' : 's'} · ${adults} adult${adults === 1 ? '' : 's'}${children ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`}
                          aside={
                            <span className="block">
                              <span className="block text-base font-extrabold">
                                {money(option.total)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                for the stay
                              </span>
                            </span>
                          }
                          selected={chosenRate.rateId === option.rateId}
                          onSelect={() => setClockRateId(option.rateId)}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              {selectedType && total ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Promo code</CardTitle>
                    <p className="m-0 text-xs text-muted-foreground">
                      Optional. The discount is worked out by the server and kept on the
                      reservation.
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex gap-2">
                      <Input
                        aria-label="Promo code"
                        value={promoInput}
                        placeholder="SUMMER10"
                        onChange={(event) => {
                          setPromoInput(event.target.value.toUpperCase());
                          if (promoState.status !== 'checking') setPromoState({ status: 'idle' });
                        }}
                      />
                      <Button
                        variant="outline"
                        disabled={!promoInput.trim() || promoState.status === 'checking'}
                        onClick={() => void checkPromo()}
                      >
                        {promoState.status === 'checking' ? 'Checking…' : 'Apply'}
                      </Button>
                    </div>
                    {appliedPromo ? (
                      <p className="m-0 text-sm">
                        <strong>{appliedPromo.code}</strong> takes{' '}
                        {money(appliedPromo.promo.discount)} off (was{' '}
                        <s>{money(appliedPromo.promo.originalTotal)}</s>, now{' '}
                        <strong>{money(appliedPromo.total)}</strong>).
                      </p>
                    ) : promoState.status === 'applied' ? (
                      <p className="m-0 text-sm text-muted-foreground">
                        The stay changed. Apply the code again.
                      </p>
                    ) : null}
                    {promoState.status === 'refused' ? (
                      <p role="alert" className="m-0 text-sm text-destructive">
                        {promoState.message}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Lead guest</CardTitle>
                  <p className="m-0 text-xs text-muted-foreground">
                    The person the reservation is for. The confirmation goes to this email, and the
                    hotel system receives the name and email.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <GuestLookup
                    tenantId={tenantId}
                    propertyId={propertyId}
                    selected={knownGuest}
                    onClear={() => setKnownGuest(null)}
                    onPick={(found) => {
                      setKnownGuest(found);
                      setGuest((current) => ({
                        ...current,
                        firstName: cleanName(found.firstName ?? ''),
                        lastName: cleanName(found.lastName ?? ''),
                        email: cleanEmail(found.email),
                        phone: parsePhone(found.phone),
                        streetAddress: found.streetAddress ?? '',
                        addressLine2: found.addressLine2 ?? '',
                        city: found.city ?? '',
                        county: found.county ?? '',
                        postcode: found.postcode ?? '',
                        countryCode: found.countryCode ?? undefined,
                      }));
                    }}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      label="First name"
                      htmlFor="guest-first"
                      required
                      error={shown('firstName')}
                    >
                      <Input
                        id="guest-first"
                        autoComplete="given-name"
                        maxLength={LIMITS.name}
                        value={guest.firstName}
                        onBlur={() => leave('firstName')}
                        onChange={(event) =>
                          setGuest({ ...guest, firstName: cleanName(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField
                      label="Last name"
                      htmlFor="guest-last"
                      required
                      error={shown('lastName')}
                    >
                      <Input
                        id="guest-last"
                        autoComplete="family-name"
                        maxLength={LIMITS.name}
                        value={guest.lastName}
                        onBlur={() => leave('lastName')}
                        onChange={(event) =>
                          setGuest({ ...guest, lastName: cleanName(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField label="Email" htmlFor="guest-email" required error={shown('email')}>
                      <Input
                        id="guest-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={LIMITS.email}
                        value={guest.email}
                        onBlur={() => leave('email')}
                        onChange={(event) =>
                          setGuest({ ...guest, email: cleanEmail(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField
                      label="Phone"
                      htmlFor="guest-phone"
                      error={shown('phone')}
                      hint="Optional. Digits only, without the prefix. Useful for arrival and payment follow-up."
                    >
                      <PhoneInput
                        id="guest-phone"
                        invalid={!!shown('phone')}
                        value={guest.phone}
                        onChange={(phone) => {
                          setGuest({ ...guest, phone });
                          leave('phone');
                        }}
                      />
                    </FormField>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Address</CardTitle>
                  <p className="m-0 text-xs text-muted-foreground">
                    Optional. Used for invoices and guest records.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      label="Street address"
                      htmlFor="guest-street"
                      className="sm:col-span-2"
                    >
                      <Input
                        id="guest-street"
                        autoComplete="address-line1"
                        maxLength={LIMITS.street}
                        value={guest.streetAddress}
                        onChange={(event) =>
                          setGuest({ ...guest, streetAddress: cleanAddress(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField
                      label="Address line 2"
                      htmlFor="guest-line2"
                      className="sm:col-span-2"
                    >
                      <Input
                        id="guest-line2"
                        autoComplete="address-line2"
                        maxLength={LIMITS.street}
                        value={guest.addressLine2}
                        onChange={(event) =>
                          setGuest({ ...guest, addressLine2: cleanAddress(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField label="City" htmlFor="guest-city">
                      <Input
                        id="guest-city"
                        autoComplete="address-level2"
                        maxLength={LIMITS.city}
                        value={guest.city}
                        onChange={(event) =>
                          setGuest({ ...guest, city: cleanName(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField label="County / region" htmlFor="guest-county">
                      <Input
                        id="guest-county"
                        autoComplete="address-level1"
                        maxLength={LIMITS.city}
                        value={guest.county}
                        onChange={(event) =>
                          setGuest({ ...guest, county: cleanName(event.target.value) })
                        }
                      />
                    </FormField>
                    <FormField label="Country">
                      <CountrySelect
                        value={guest.countryCode}
                        onChange={(countryCode) => setGuest({ ...guest, countryCode })}
                      />
                    </FormField>
                    <FormField label="Postcode" htmlFor="guest-postcode">
                      <Input
                        id="guest-postcode"
                        autoComplete="postal-code"
                        maxLength={LIMITS.postcode}
                        value={guest.postcode}
                        onChange={(event) =>
                          setGuest({ ...guest, postcode: cleanPostcode(event.target.value) })
                        }
                      />
                    </FormField>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Stay preferences</CardTitle>
                  <p className="m-0 text-xs text-muted-foreground">
                    Optional. Shown at the top of the reservation so the desk and housekeeping can
                    see them.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      label="Estimated arrival time"
                      htmlFor="guest-arrival"
                      hint={
                        hotelCheckIn
                          ? `Starts at the hotel check-in time (${hotelCheckIn}).`
                          : 'Optional.'
                      }
                    >
                      <TimeField
                        id="guest-arrival"
                        label="Estimated arrival time"
                        value={guest.arrivalTime}
                        onChange={(arrivalTime) => setGuest({ ...guest, arrivalTime })}
                        min={hotelCheckIn || undefined}
                        defaultValue={hotelCheckIn || undefined}
                        defaultLabel="Use check-in time"
                      />
                    </FormField>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={guest.accessibility}
                      onCheckedChange={(value) =>
                        setGuest({ ...guest, accessibility: value === true })
                      }
                    />
                    Needs an accessible room
                  </label>
                  <FormField
                    label="Special requests"
                    htmlFor="guest-requests"
                    hint="Anything else the hotel should know."
                  >
                    <Textarea
                      id="guest-requests"
                      maxLength={LIMITS.note}
                      value={guest.specialRequests}
                      onChange={(event) =>
                        setGuest({ ...guest, specialRequests: event.target.value })
                      }
                    />
                  </FormField>
                </CardContent>
              </Card>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Payment</CardTitle>
                  <p className="m-0 text-xs text-muted-foreground">
                    Only the options this hotel has enabled are listed.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 px-4 py-3">
                    <div>
                      <p className="m-0 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                        Amount to collect
                      </p>
                      <p className="m-0 text-2xl font-extrabold tracking-tight">
                        {total ? money(total) : '—'}
                      </p>
                    </div>
                    <p className="m-0 text-xs text-muted-foreground">
                      {nights} night{nights === 1 ? '' : 's'} · {selectedType?.name}
                    </p>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Payment method"
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {(['pay_at_hotel', 'stripe', 'pokpay'] as const)
                      .filter((method) =>
                        method === 'pay_at_hotel'
                          ? paymentGateways?.payAtHotel
                          : paymentGateways?.[method],
                      )
                      .map((method) => (
                        <OptionCard
                          key={method}
                          icon={method === 'pay_at_hotel' ? Building2 : CreditCard}
                          title={gatewayLabels[method].title}
                          badges={
                            method === 'pay_at_hotel' ? (
                              <Badge
                                variant="success"
                                className="rounded-full px-2 py-0 text-[10px]"
                              >
                                Confirmed now
                              </Badge>
                            ) : (
                              <Badge variant="info" className="rounded-full px-2 py-0 text-[10px]">
                                Confirms when paid
                              </Badge>
                            )
                          }
                          description={gatewayLabels[method].description}
                          selected={gateway === method}
                          onSelect={() => {
                            setGateway(method);
                            setSettle('');
                          }}
                        />
                      ))}
                  </div>
                  {!paymentGateways?.payAtHotel &&
                  !paymentGateways?.stripe &&
                  !paymentGateways?.pokpay ? (
                    <Alert variant="warning">
                      <AlertTitle>No payment method is enabled</AlertTitle>
                      <AlertDescription>
                        Enable one in Settings before creating reservations here.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {gateway === 'pay_at_hotel' && canRecordPayment ? (
                    <div className="space-y-2 rounded-xl border p-4">
                      <SectionLabel>Record a payment now</SectionLabel>
                      <p className="m-0 text-xs text-muted-foreground">
                        Choose how the guest is paying at the desk right now, or leave it for later.
                      </p>
                      <SegmentedControl
                        label="Record a payment now"
                        value={settle}
                        onChange={setSettle}
                        options={[
                          { value: '', label: 'Not now' },
                          { value: 'cash', label: 'Cash' },
                          { value: 'card_in_person', label: 'Card at the desk' },
                          { value: 'bank_transfer', label: 'Bank transfer' },
                        ]}
                      />
                    </div>
                  ) : gateway ? (
                    <div className="space-y-2 rounded-xl border border-info/30 bg-info-surface p-4 text-sm text-info">
                      <p className="m-0 font-bold">How the card payment works</p>
                      <ol className="m-0 list-decimal space-y-1 pl-5 text-foreground">
                        <li>The reservation is created and the room is held, but not confirmed.</li>
                        <li>
                          {gateway === 'stripe'
                            ? 'A secure Stripe window opens for payment.'
                            : 'Choose Pay, Send link, Copy link or QR code once the reservation is held.'}
                        </li>
                        <li>
                          This page watches the payment and confirms the reservation only when the
                          provider says it is paid.
                        </li>
                      </ol>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <SectionLabel>Stay</SectionLabel>
                    <DetailList
                      items={[
                        {
                          label: 'Dates',
                          value: `${longDate(startsOn)} – ${longDate(endsOn)} (${nights} nights)`,
                        },
                        { label: 'Room type', value: selectedType?.name },
                        ...(chosenRate ? [{ label: 'Rate', value: chosenRate.label }] : []),
                        ...(appliedPromo
                          ? [
                              { label: 'Promo code', value: appliedPromo.code },
                              {
                                label: 'Discount',
                                value: `-${money(appliedPromo.promo.discount)}`,
                              },
                            ]
                          : []),
                        {
                          label: 'Room',
                          value: selectedRoom?.name ?? (showRoomPick ? 'Auto-assign' : null),
                        },
                        {
                          label: 'Guests',
                          value: `${adults} adult${adults === 1 ? '' : 's'}${children ? ` · ${children} child${children === 1 ? '' : 'ren'}` : ''}`,
                        },
                      ]}
                    />
                  </div>
                  <div>
                    <SectionLabel>Guest</SectionLabel>
                    <DetailList
                      items={[
                        { label: 'Name', value: `${guest.firstName} ${guest.lastName}` },
                        { label: 'Email', value: guest.email },
                        { label: 'Phone', value: phoneToString(guest.phone) },
                        {
                          label: 'Address',
                          value: [
                            guest.streetAddress,
                            guest.addressLine2,
                            guest.city,
                            guest.county,
                            guest.postcode,
                          ]
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .join(', '),
                        },
                        { label: 'Requests', value: requestsText(guest)?.replaceAll('\n', ' · ') },
                      ]}
                    />
                  </div>
                  <div>
                    <SectionLabel>Payment</SectionLabel>
                    <DetailList
                      items={[
                        { label: 'Method', value: gateway ? gatewayLabels[gateway].title : null },
                        { label: 'Amount', value: total ? money(total) : null },
                        {
                          label: 'After creating',
                          value:
                            gateway === 'pay_at_hotel'
                              ? settle
                                ? 'Confirmed and paid'
                                : 'Confirmed, payment due at the hotel'
                              : gateway
                                ? 'Waiting for the guest to pay'
                                : null,
                        },
                      ]}
                    />
                  </div>
                  {create.isError ? (
                    <Alert variant="destructive">
                      <AlertTitle>The reservation was not created</AlertTitle>
                      <AlertDescription>{errorMessage(create.error)}</AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            </>
          ) : null}

          <ActionBar className="justify-between">
            <div className="flex gap-2">
              {step > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => setStep(step - 1)}
                  disabled={create.isPending}
                >
                  <ArrowLeft aria-hidden="true" /> Back
                </Button>
              ) : (
                <Button variant="ghost" asChild>
                  <a href={href(tenantId, propertyId, 'section=reservations')}>Cancel</a>
                </Button>
              )}
              {step > 0 ? (
                <Button variant="ghost" onClick={reset} disabled={create.isPending}>
                  Start over
                </Button>
              ) : null}
            </div>
            {step === 0 ? (
              <Button disabled={!stayComplete} onClick={() => setStep(1)}>
                Continue to guest information <ArrowRight aria-hidden="true" />
              </Button>
            ) : step === 1 ? (
              <Button
                onClick={() => {
                  setTouched(true);
                  if (guestComplete) setStep(2);
                }}
              >
                Continue to payment &amp; review <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <Button
                disabled={!gateway || create.isPending}
                loading={create.isPending}
                onClick={() => {
                  if (gateway === 'stripe') {
                    const opened = window.open('', '_blank');
                    if (opened) {
                      // The provider's page must not be able to control this page.
                      opened.opener = null;
                      opened.document.title = 'Payment';
                      opened.document.body.textContent = 'Opening the secure payment page…';
                    }
                    payWindow.current = opened;
                  }
                  create.mutate();
                }}
              >
                Create reservation
              </Button>
            )}
          </ActionBar>
        </div>

        {summary}
      </div>
    </div>
  );
}

async function post(url: string, body: unknown, idempotencyKey?: string) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status >= 500)
      throw new Error('The service is temporarily unavailable. Please retry.');
    throw new Error(await response.text());
  }
  return response.json();
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : 'Request failed.';
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    return Array.isArray(parsed.message) ? parsed.message.join(' ') : (parsed.message ?? raw);
  } catch {
    return raw;
  }
}
