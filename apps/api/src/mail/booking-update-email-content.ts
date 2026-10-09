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
  intro: string;
  rows: Array<{ label: string; value: string }>;
  cta: { url: string; label: string } | null;
  eventType: string;
  closing: string;
}): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = input.brand.name || 'the hotel';
  const html = renderBrandedEmail({
    subject: input.subject,
    brand: input.brand,
    preheader: input.preheader,
    heading: input.heading,
    content: `<p style="margin:0 0 18px 0;">Hello <strong>${escapeHtml(input.stay.guestName)}</strong>, ${escapeHtml(input.intro)}</p><p style="margin:0 0 18px 0;">${escapeHtml(input.closing)}</p>`,
    summaryRows: input.rows,
    summaryHeading: 'Your booking',
    cta: input.cta,
    footerNote: `You&#39;re receiving this email because you made a booking at ${escapeHtml(hotel)}.`,
  });
  const text = [
    `Hello ${input.stay.guestName},`,
    input.intro,
    ...input.rows.map((row) => `${row.label}: ${row.value.replace(/\n/g, '; ')}`),
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`] : []),
    input.closing,
  ].join('\n');
  return {
    eventType: input.eventType,
    to: input.stay.guestEmail,
    subject: input.subject,
    html,
    text,
    bookingId: input.stay.bookingId,
    replyTo: input.brand.supportEmail ?? null,
  };
}

/** The hotel changed the dates or room type of a confirmed booking. */
export function bookingChangedEmail(
  stay: GuestStay,
  previous: { startsOn: string; endsOn: string; roomName: string },
  brand: MailBrand,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'the hotel';
  const subject = `Your booking at ${hotel} has been updated — ${stay.reference}`;
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
    intro: `${hotel} has updated your booking. Here are the new details.`,
    rows,
    cta: null,
    eventType: 'guest.booking_changed',
    closing: 'If you did not ask for this change, simply reply to this email.',
  });
}

/** The guest started a booking but the payment was not completed in time. */
export function paymentNotCompletedEmail(
  stay: GuestStay,
  brand: MailBrand,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'the hotel';
  const subject = `Your booking at ${hotel} was not completed`;
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
    intro: `the payment for your booking at ${hotel} was not completed in time, so the booking was not made and the room was released. You have not been charged; if a payment still goes through, it is refunded automatically.`,
    rows,
    cta: brand.websiteUrl ? { url: brand.websiteUrl, label: 'Book again' } : null,
    eventType: 'guest.payment_not_completed',
    closing:
      'Still want to stay with us? You are welcome to book again, or simply reply to this email.',
  });
}
