'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { fetchPropertyBookings, type Reservation } from './reservations';
import styles from './calendar.module.css';

type RoomType = { id: string; name: string };
export type CalendarAvailability = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
  availableUnits: number;
};

type CalendarData = { roomTypes: RoomType[]; availability: CalendarAvailability[] };

export function DashboardCalendar({
  tenantId,
  propertyId,
  initialMonth,
  initialRoomTypes,
  initialAvailability,
  initialBookings,
}: {
  tenantId: string;
  propertyId: string;
  initialMonth?: string;
  initialRoomTypes?: RoomType[];
  initialAvailability?: CalendarAvailability[];
  initialBookings?: Reservation[];
}) {
  const [month, setMonth] = useState(initialMonth ?? monthStart(new Date()));
  const [calendarData, setCalendarData] = useState<CalendarData | null | undefined>(
    initialRoomTypes && initialAvailability
      ? { roomTypes: initialRoomTypes, availability: initialAvailability }
      : undefined,
  );
  const [bookings, setBookings] = useState<Reservation[] | null | undefined>(initialBookings);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialRoomTypes && initialAvailability && initialMonth === month) {
      setCalendarData({ roomTypes: initialRoomTypes, availability: initialAvailability });
      return;
    }
    let active = true;
    setCalendarData(undefined);
    void fetchCalendarAvailability(tenantId, propertyId, month)
      .then((value) => active && setCalendarData(value))
      .catch((reason: unknown) => {
        if (!active) return;
        setCalendarData(null);
        setError(
          reason instanceof Error ? reason.message : 'Unable to load calendar availability.',
        );
      });
    return () => {
      active = false;
    };
  }, [initialAvailability, initialMonth, initialRoomTypes, month, propertyId, tenantId]);

  useEffect(() => {
    if (initialBookings) return;
    let active = true;
    void fetchPropertyBookings(tenantId, propertyId)
      .then((value) => active && setBookings(value))
      .catch((reason: unknown) => {
        if (!active) return;
        setBookings(null);
        setError(reason instanceof Error ? reason.message : 'Unable to load reservations.');
      });
    return () => {
      active = false;
    };
  }, [initialBookings, propertyId, tenantId]);

  const days = useMemo(() => calendarDays(month), [month]);
  const selectedBookings = selectedDay && bookings ? bookingsForDay(bookings, selectedDay) : null;

  if (calendarData === undefined || bookings === undefined) return <Text>Loading calendar…</Text>;
  if (!calendarData || !bookings) return <Text className={styles.error}>{error}</Text>;

  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PROPERTY OPERATIONS
          </Text>
          <Heading>Calendar</Heading>
          <Text tone="secondary">Nightly room-type availability from local inventory.</Text>
        </div>
        <div className={styles.monthControls} aria-label="Calendar month">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <strong>{formatMonth(month)}</strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <Card>
        <div className={styles.legend} aria-label="Availability legend">
          <span>
            <i className={styles.available} /> Available
          </span>
          <span>
            <i className={styles.limited} /> Limited
          </span>
          <span>
            <i className={styles.unavailable} /> Sold out
          </span>
        </div>
        <div className={styles.grid}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <strong key={day} className={styles.weekday}>
              {day}
            </strong>
          ))}
          {days.map((day, index) =>
            day ? (
              <button
                key={day}
                type="button"
                className={styles.day}
                aria-label={`Open ${day}`}
                onClick={() => setSelectedDay(day)}
              >
                <time dateTime={day}>{Number(day.slice(-2))}</time>
                <div>
                  {calendarData.roomTypes.map((roomType) => {
                    const availability = calendarData.availability.find(
                      (item) => item.roomTypeId === roomType.id && item.startsOn === day,
                    );
                    return (
                      <span
                        key={roomType.id}
                        className={availabilityClass(availability?.availableUnits ?? 0)}
                        title={`${roomType.name}: ${availability?.availableUnits ?? 0} remaining`}
                      >
                        <b>{roomType.name}</b> {availability?.availableUnits ?? 0}
                      </span>
                    );
                  })}
                </div>
              </button>
            ) : (
              <div key={`empty-${index}`} className={styles.emptyDay} aria-hidden="true" />
            ),
          )}
        </div>
      </Card>

      {selectedDay && selectedBookings ? (
        <DayBookings day={selectedDay} bookings={selectedBookings} />
      ) : null}
    </Stack>
  );
}

export async function fetchCalendarAvailability(
  tenantId: string,
  propertyId: string,
  month: string,
): Promise<CalendarData> {
  const roomTypesResponse = await fetch(
    `/api/tenants/${tenantId}/properties/${propertyId}/room-types`,
    { credentials: 'include' },
  );
  if (!roomTypesResponse.ok) throw new Error('Unable to load room types.');
  const roomTypes = (await roomTypesResponse.json()) as RoomType[];
  const days = calendarDays(month).filter((day): day is string => day !== null);
  const availability = await Promise.all(
    roomTypes.flatMap((roomType) =>
      days.map(async (day) => {
        const nextDay = addDays(day, 1);
        const response = await fetch(
          `/api/tenants/${tenantId}/properties/${propertyId}/availability?${new URLSearchParams({ roomTypeId: roomType.id, startsOn: day, endsOn: nextDay })}`,
          { credentials: 'include' },
        );
        if (!response.ok) throw new Error('Unable to load calendar availability.');
        return (await response.json()) as CalendarAvailability;
      }),
    ),
  );
  return { roomTypes, availability };
}

export function bookingsForDay(bookings: Reservation[], day: string) {
  const active = bookings.filter((booking) => booking.status === 'CONFIRMED');
  return {
    arrivals: active.filter((booking) => booking.startsOn === day),
    departures: active.filter((booking) => booking.endsOn === day),
    inHouse: active.filter((booking) => booking.startsOn < day && booking.endsOn > day),
  };
}

function DayBookings({
  day,
  bookings,
}: {
  day: string;
  bookings: ReturnType<typeof bookingsForDay>;
}) {
  return (
    <section aria-label="Day bookings">
      <Card className={styles.drillIn}>
        <Heading level={2}>{formatDay(day)}</Heading>
        <Text tone="secondary">
          Read-only operational view. Inventory changes are not available here.
        </Text>
        <div className={styles.bookingColumns}>
          <BookingList label="Arrivals" bookings={bookings.arrivals} />
          <BookingList label="Departures" bookings={bookings.departures} />
          <BookingList label="In house" bookings={bookings.inHouse} />
        </div>
      </Card>
    </section>
  );
}

function BookingList({ label, bookings }: { label: string; bookings: Reservation[] }) {
  return (
    <section>
      <Heading level={3}>
        {label} ({bookings.length})
      </Heading>
      {bookings.length ? (
        <ul>
          {bookings.map((booking) => (
            <li key={booking.id}>
              <strong>
                {[booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') ||
                  booking.guestEmail}
              </strong>
              <Text tone="secondary">
                {booking.roomTypeName} · {booking.status.toLowerCase().replaceAll('_', ' ')}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text tone="secondary">None</Text>
      )}
    </section>
  );
}

function calendarDays(month: string) {
  const first = new Date(`${month}T00:00:00Z`);
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return [
    ...Array(leading).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
    ),
    ...Array((7 - ((leading + daysInMonth) % 7)) % 7).fill(null),
  ] as Array<string | null>;
}
function monthStart(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(month: string, amount: number) {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}
function addDays(day: string, amount: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function formatMonth(month: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
function formatDay(day: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
function availabilityClass(availableUnits: number) {
  return availableUnits <= 0
    ? styles.unavailable
    : availableUnits === 1
      ? styles.limited
      : styles.available;
}
