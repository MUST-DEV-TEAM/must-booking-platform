import type { MailBrand, RenderedEmailCommand } from '@must/domain-contracts';

import { escapeHtml, renderBrandedEmail, renderCtaButton } from './email-layout';

export type PreArrivalStay = {
  bookingId: string;
  /** The order reference for a multi-room order, else the booking reference. */
  reference: string;
  guestEmail: string;
  guestName: string;
  startsOn: string;
  endsOn: string;
  rooms: Array<{ roomName: string; guestCount: number }>;
  /** Set when payment is collected at the hotel. */
  dueAtHotel: { amount: string; currency: string } | null;
};

export type OwnerDailySummary = {
  date: string;
  arrivals: Array<{ guestName: string; roomName: string; nights: number }>;
  departures: Array<{ guestName: string; roomName: string }>;
  inHouse: number;
  newBookings: { count: number; revenue: Array<{ amount: string; currency: string }> };
  cancellations: number;
};

const LIST_LIMIT = 15;

export function longDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export function nights(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function money(value: { amount: string; currency: string }): string {
  return `${value.amount} ${value.currency}`;
}

function list(lines: string[]): string {
  if (lines.length <= LIST_LIMIT) return lines.join('\n');
  return [...lines.slice(0, LIST_LIMIT), `and ${lines.length - LIST_LIMIT} more`].join('\n');
}

/** Guest reminder a few days before check-in (one per booking or multi-room order). */
export function preArrivalEmail(
  stay: PreArrivalStay,
  brand: MailBrand & { checkInTime?: string | null },
  message: { subject: string; html: string; text: string },
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'the hotel';
  const subject = message.subject;
  const guests = stay.rooms.reduce((sum, room) => sum + room.guestCount, 0);
  const roomValue =
    stay.rooms.length === 1
      ? stay.rooms[0]!.roomName
      : stay.rooms
          .map(
            (room, index) => `${index + 1}. ${room.roomName} — ${plural(room.guestCount, 'guest')}`,
          )
          .join('\n');
  const rows = [
    { label: 'Booking reference', value: stay.reference },
    { label: stay.rooms.length === 1 ? 'Room' : 'Rooms', value: roomValue },
    {
      label: 'Dates',
      value: `${longDate(stay.startsOn)} – ${longDate(stay.endsOn)} (${plural(nights(stay.startsOn, stay.endsOn), 'night')})`,
    },
    { label: 'Guests', value: String(guests) },
    ...(brand.checkInTime ? [{ label: 'Check-in from', value: brand.checkInTime }] : []),
    ...(stay.dueAtHotel ? [{ label: 'Due at the hotel', value: money(stay.dueAtHotel) }] : []),
    ...(brand.address ? [{ label: 'Address', value: brand.address }] : []),
  ];
  const html = renderBrandedEmail({
    subject,
    brand,
    preheader: `Your stay at ${hotel} starts on ${longDate(stay.startsOn)}.`,
    heading: 'Your stay is coming up',
    content: message.html,
    summaryRows: rows,
    summaryHeading: 'Your stay',
    footerNote: `You&#39;re receiving this email because you have a reservation at ${escapeHtml(hotel)}.`,
  });
  const text = [
    message.text,
    '',
    ...rows.map((row) => `${row.label}: ${row.value.replace(/\n/g, '; ')}`),
  ].join('\n');
  return {
    eventType: 'guest.pre_arrival',
    to: stay.guestEmail,
    subject,
    html,
    text,
    bookingId: stay.bookingId,
    replyTo: brand.supportEmail ?? null,
  };
}

/** The owner's morning overview of one property. */
export function ownerDailySummaryEmail(
  summary: OwnerDailySummary,
  to: string,
  brand: MailBrand,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'your property';
  const subject = `${hotel} today: ${plural(summary.arrivals.length, 'arrival')}, ${plural(summary.departures.length, 'departure')}`;
  const revenue = summary.newBookings.revenue.map(money).join(' + ');
  const rows = [
    {
      label: `Arrivals (${summary.arrivals.length})`,
      value: summary.arrivals.length
        ? list(
            summary.arrivals.map(
              (a) => `${a.guestName} · ${a.roomName} · ${plural(a.nights, 'night')}`,
            ),
          )
        : 'None',
    },
    {
      label: `Departures (${summary.departures.length})`,
      value: summary.departures.length
        ? list(summary.departures.map((d) => `${d.guestName} · ${d.roomName}`))
        : 'None',
    },
    { label: 'In-house tonight', value: plural(summary.inHouse, 'booking') },
    {
      label: 'New bookings yesterday',
      value: summary.newBookings.count
        ? `${summary.newBookings.count}${revenue ? ` · ${revenue}` : ''}`
        : 'None',
    },
    { label: 'Cancellations yesterday', value: String(summary.cancellations || 'None') },
  ];
  const html = renderBrandedEmail({
    subject,
    brand,
    preheader: `${plural(summary.arrivals.length, 'arrival')} and ${plural(summary.departures.length, 'departure')} today.`,
    eyebrow: longDate(summary.date),
    heading: `Today at ${hotel}`,
    content: `<p style="margin:0;">Here is your daily overview.</p>`,
    summaryRows: rows,
    summaryHeading: 'Daily summary',
    cta: dashboardUrl ? { url: dashboardUrl, label: 'Open dashboard' } : null,
    supportStyle: 'plain',
    supportLinks: [],
    showBrandFooter: false,
    footerNote: `You get this summary as an owner of ${escapeHtml(hotel)}. You can turn it off in the property&#39;s email settings.`,
    platformFooter: 'MUST Booking Platform',
  });
  const text = [
    `Today at ${hotel} — ${longDate(summary.date)}`,
    ...rows.map((row) => `${row.label}: ${row.value.replace(/\n/g, '; ')}`),
    ...(dashboardUrl ? [`Dashboard: ${dashboardUrl}`] : []),
  ].join('\n');
  return { eventType: 'owner.daily_summary', to, subject, html, text, bookingId: null };
}

/** Guest thank-you after check-out, with a button per review link. */
export function postStayEmail(
  stay: PreArrivalStay,
  brand: MailBrand,
  message: { subject: string; html: string; text: string },
  reviewButtons: Array<{ url: string; label: string }>,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'the hotel';
  const buttons = reviewButtons.map(renderCtaButton).join('');
  const html = renderBrandedEmail({
    subject: message.subject,
    brand,
    preheader: `Thank you for staying at ${hotel}.`,
    heading: 'Thank you for staying with us',
    content: message.html + buttons,
    summaryRows: [
      { label: 'Booking reference', value: stay.reference },
      {
        label: 'Your stay',
        value: `${longDate(stay.startsOn)} – ${longDate(stay.endsOn)}`,
      },
    ],
    summaryHeading: 'Your stay',
    footerNote: `You&#39;re receiving this email because you stayed at ${escapeHtml(hotel)}.`,
  });
  const text = [
    message.text,
    '',
    ...reviewButtons.map((button) => `${button.label}: ${button.url}`),
    '',
    `Booking reference: ${stay.reference}`,
  ].join('\n');
  return {
    eventType: 'guest.post_stay',
    to: stay.guestEmail,
    subject: message.subject,
    html,
    text,
    bookingId: stay.bookingId,
    replyTo: brand.supportEmail ?? null,
  };
}
