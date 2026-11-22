import type { MailBrand, RenderedEmailCommand } from '@must/domain-contracts';

import type { GroupRequestInput } from '../booking/group-request';
import { escapeHtml, renderBrandedEmail } from './email-layout';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const nights = (startsOn: string, endsOn: string) =>
  Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000);

/** The facts of a request as rows, for both emails. */
function rows(request: GroupRequestInput) {
  const guests = [
    plural(request.adults, 'adult'),
    request.children
      ? `${request.children} ${request.children === 1 ? 'child' : 'children'}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    {
      label: 'Name',
      value: request.organisation ? `${request.name} (${request.organisation})` : request.name,
    },
    { label: 'Email', value: request.email },
    { label: 'Phone', value: request.phone ?? '' },
    {
      label: 'Stay',
      value: `${request.startsOn} to ${request.endsOn} (${plural(nights(request.startsOn, request.endsOn), 'night')})`,
    },
    { label: 'Guests', value: guests },
    { label: 'Rooms', value: String(request.rooms) },
    { label: 'Message', value: request.message ?? '' },
  ];
}

/** To the hotel: a guest asks for a group quote. Reply to the guest's email to answer. */
export function groupRequestHotelEmail(
  brand: MailBrand,
  request: GroupRequestInput,
  to: string,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'your hotel';
  const subject =
    `Group request: ${request.name}, ${plural(request.adults + request.children, 'guest')}, ${request.startsOn}`.slice(
      0,
      200,
    );
  const intro = `${request.name} asked ${hotel} for a group quote. Reply to ${request.email} to answer. The request is also recorded in the dashboard.`;
  const html = renderBrandedEmail({
    subject,
    brand,
    preheader: intro,
    heading: 'New group request',
    content: `<p style="margin:0;">${escapeHtml(intro)}</p>`,
    summaryRows: rows(request),
    summaryHeading: 'Request',
    cta: dashboardUrl ? { url: dashboardUrl, label: 'Open dashboard' } : null,
    supportStyle: 'plain',
    supportLinks: [],
    showBrandFooter: false,
    footerNote: escapeHtml(
      `You get this because ${hotel} shows a group request form on its website.`,
    ),
    platformFooter: 'MUST Booking Platform',
  });
  const text = [
    'New group request',
    intro,
    ...rows(request)
      .filter((row) => row.value)
      .map((row) => `${row.label}: ${row.value}`),
    ...(dashboardUrl ? [`Dashboard: ${dashboardUrl}`] : []),
  ].join('\n');
  return {
    eventType: 'staff.group_request',
    to,
    subject,
    html,
    text,
    bookingId: null,
    replyTo: request.email,
  };
}

/**
 * To the guest: the request arrived and the hotel will answer. The address is not verified, so this message is
 * fixed: it echoes nothing the guest typed (name, organisation, message), only dates and counts, so the form cannot
 * be used to send chosen text to a stranger.
 */
export function groupRequestGuestEmail(
  brand: MailBrand,
  request: GroupRequestInput,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'the hotel';
  const subject = `We received your group request, ${hotel}`.slice(0, 200);
  const intro = `We received a group request for this email address and ${hotel} will reply with a quote. This is not a booking yet. If you did not send a request, you can ignore this message.`;
  const facts = rows(request).filter((row) => ['Stay', 'Guests', 'Rooms'].includes(row.label));
  const html = renderBrandedEmail({
    subject,
    brand,
    preheader: intro,
    heading: 'We received your request',
    content: `<p style="margin:0;">${escapeHtml(intro)}</p>`,
    summaryRows: facts,
    summaryHeading: 'Your request',
    supportStyle: 'plain',
    supportLinks: [],
    showBrandFooter: false,
  });
  const text = [intro, ...facts.map((row) => `${row.label}: ${row.value}`)].join('\n');
  return {
    eventType: 'guest.group_request_received',
    to: request.email,
    subject,
    html,
    text,
    bookingId: null,
  };
}
