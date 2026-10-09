import type { MailBrand, RenderedEmailCommand } from '@must/domain-contracts';

import { escapeHtml, renderBrandedEmail } from './email-layout';
import { longDate, nights, plural } from './scheduled-email-content';

export type GuestStay = {
  bookingId: string;
  /** The order reference for a multi-room order, else the booking reference. */
  reference: string;
  guestEmail: string;
  guestName: string;
  startsOn: string;
  endsOn: string;
  rooms: Array<{ roomName: string; guestCount: number }>;
};

function dates(startsOn: string, endsOn: string): string {
  return `${longDate(startsOn)} – ${longDate(endsOn)} (${plural(nights(startsOn, endsOn), 'night')})`;
}

function roomsValue(stay: GuestStay): string {
  return stay.rooms.length === 1
    ? stay.rooms[0]!.roomName
    : stay.rooms
        .map(
          (room, index) => `${index + 1}. ${room.roomName} — ${plural(room.guestCount, 'guest')}`,
        )
        .join('\n');
}

function guestEmail(input: {
  stay: GuestStay;
  brand: MailBrand;
  subject: string;
  preheader: string;
  heading: string;
  message: { html: string; text: string };
  rows: Array<{ label: string; value: string }>;
  cta: { url: string; label: string } | null;
  eventType: string;
}): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = input.brand.name || 'the hotel';
  const html = renderBrandedEmail({
    subject: input.subject,
    brand: input.brand,
    preheader: input.preheader,
    heading: input.heading,
    content: input.message.html,
    summaryRows: input.rows,
    summaryHeading: 'Your booking',
    cta: input.cta,
    footerNote: `You&#39;re receiving this email because you made a booking at ${escapeHtml(hotel)}.`,
  });
  const text = [
    input.message.text,
    '',
    ...input.rows.map((row) => `${row.label}: ${row.value.replace(/\n/g, '; ')}`),
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`] : []),
  ].join('\n');
  return {
    eventType: input.eventType,
    to: input.stay.guestEmail,
    subject: input.subject,
    html,
    text,
    bookingId: input.stay.bookingId,
    replyTo: input.brand.supportEmail ?? null,
    fromName: input.brand.name || null,
  };
}

/** The hotel changed the dates or room type of a confirmed booking. */
export function bookingChangedEmail(
  stay: GuestStay,
  previous: { startsOn: string; endsOn: string; roomName: string },
  brand: MailBrand,
  message: { subject: string; html: string; text: string },
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const subject = message.subject;
  const datesChanged = previous.startsOn !== stay.startsOn || previous.endsOn !== stay.endsOn;
  const roomChanged = previous.roomName !== stay.rooms[0]?.roomName;
  const rows = [
    { label: 'Booking reference', value: stay.reference },
    { label: stay.rooms.length === 1 ? 'Room' : 'Rooms', value: roomsValue(stay) },
    { label: 'Dates', value: dates(stay.startsOn, stay.endsOn) },
    {
      label: 'Guests',
      value: String(stay.rooms.reduce((sum, room) => sum + room.guestCount, 0)),
    },
    ...(datesChanged
      ? [{ label: 'Previous dates', value: dates(previous.startsOn, previous.endsOn) }]
      : []),
    ...(roomChanged ? [{ label: 'Previous room', value: previous.roomName }] : []),
  ];
  return guestEmail({
    stay,
    brand,
    subject,
    preheader: `Your stay is now ${dates(stay.startsOn, stay.endsOn)}.`,
    heading: 'Your booking has been updated',
    message,
    rows,
    cta: null,
    eventType: 'guest.booking_changed',
  });
}

/** The guest started a booking but the payment was not completed in time. */
export function paymentNotCompletedEmail(
  stay: GuestStay,
  brand: MailBrand,
  message: { subject: string; html: string; text: string },
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const subject = message.subject;
  const rows = [
    { label: stay.rooms.length === 1 ? 'Room' : 'Rooms', value: roomsValue(stay) },
    { label: 'Dates', value: dates(stay.startsOn, stay.endsOn) },
  ];
  return guestEmail({
    stay,
    brand,
    subject,
    preheader: 'The payment was not completed, so the booking was not made.',
    heading: 'Your booking was not completed',
    message,
    rows,
    cta: brand.websiteUrl ? { url: brand.websiteUrl, label: 'Book again' } : null,
    eventType: 'guest.payment_not_completed',
  });
}
