import type { Property } from './settings-areas';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const monthDay = (value: string) => {
  const [month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const dayList = (days: number[] | undefined) =>
  !days || days.length === 0 || days.length === 7
    ? null
    : days
        .slice()
        .sort()
        .map((day) => DAYS[day - 1])
        .join(', ');

/** The saved booking rules as short plain sentences, for the top of the Booking rules page. */
export function describeBookingRules(property: Property): string[] {
  const lines: string[] = [];
  const min = property.minStayNights ?? null;
  const max = property.maxStayNights ?? null;
  if (min && max) lines.push(`Guests can stay ${min} to ${plural(max, 'night')}.`);
  else if (min) lines.push(`Guests must stay at least ${plural(min, 'night')}.`);
  else if (max) lines.push(`Guests can stay up to ${plural(max, 'night')}.`);
  else lines.push('Guests can stay any number of nights.');

  const notice = property.minNoticeHours ?? null;
  const ahead = property.advanceBookingDays ?? null;
  if (notice && ahead)
    lines.push(
      `Bookings close ${plural(notice, 'hour')} before arrival and open ${plural(ahead, 'day')} ahead.`,
    );
  else if (notice) lines.push(`Bookings close ${plural(notice, 'hour')} before the arrival day.`);
  else if (ahead) lines.push(`Guests can book up to ${plural(ahead, 'day')} ahead.`);

  if (property.seasonOpenFrom && property.seasonOpenTo)
    lines.push(
      `Open for bookings from ${monthDay(property.seasonOpenFrom)} to ${monthDay(property.seasonOpenTo)} each year.`,
    );
  else lines.push('Open for bookings all year.');

  const arrivals = dayList(property.arrivalDays);
  const departures = dayList(property.departureDays);
  lines.push(arrivals ? `Guests can only arrive on ${arrivals}.` : 'Guests can arrive on any day.');
  if (departures) lines.push(`Guests can only leave on ${departures}.`);

  if (property.allowSameDayBooking === false) lines.push('Same-day bookings are not taken.');
  else if (property.sameDayCutoffTime)
    lines.push(`Same-day bookings close at ${property.sameDayCutoffTime}.`);

  const guests = property.maxGuestsPerBooking ?? null;
  const rooms = property.maxRoomsPerBooking ?? null;
  if (guests || rooms) {
    const limits = [guests ? plural(guests, 'guest') : null, rooms ? plural(rooms, 'room') : null]
      .filter(Boolean)
      .join(' and ');
    lines.push(
      `A booking can have up to ${limits}${property.groupRequestForm ? '; bigger groups can send a request' : ''}.`,
    );
  }

  // Confirmation mode, guest ages and gap filling are saved but not applied to bookings yet; the booking form is shown in the table
  // (see NOT_APPLIED_YET), so they are not described here. The booking form has its own label.
  return lines;
}
