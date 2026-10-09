import type { MailBrand, RenderedEmailCommand } from '@must/domain-contracts';

import { escapeHtml, MUST_BOOKING_BRAND, renderBrandedEmail } from './email-layout';
import { longDate } from './scheduled-email-content';

/** One row of `notification_alert_events()`. */
export type AlertEvent = {
  tenantId: string;
  propertyId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  kind:
    | 'booking_attention'
    | 'clock_review'
    | 'clock_event_failed'
    | 'refund'
    | 'new_hotel'
    | 'email_failed';
  itemId: string;
  reference: string | null;
  detail: string | null;
  occurredAt: Date;
};

export type PlatformDailyStats = {
  hotels: number;
  properties: number;
  newHotels: number;
  bookings: number;
  cancellations: number;
  emailsSent: number;
  emailsFailed: number;
  openReviews: number;
  clockEventsFailed: number;
};

const LIST_LIMIT = 20;

const BOOKING_STATUS_TEXT: Record<string, string> = {
  MANUAL_REVIEW: 'needs a manual check',
  PAYMENT_FAILED: 'payment failed',
  AVAILABILITY_FAILED: 'the room was no longer available',
  PMS_REJECTED: 'Clock rejected the booking',
  PMS_UNKNOWN_RESULT: 'Clock did not confirm the booking',
};

/** Clock wording, kept short; full details are in the dashboard and the error tracker. */
function clockLine(event: AlertEvent): string {
  if (event.kind === 'clock_review')
    return `Clock sync needs a check: ${event.detail ?? ''}`.trim();
  return `A Clock update could not be processed (${event.detail ?? 'update'}${event.reference ? ` for ${event.reference}` : ''})`;
}

/** One plain-text line describing an event for the hotel's own staff. */
export function ownerAlertLine(event: AlertEvent): string {
  switch (event.kind) {
    case 'booking_attention':
      return `Booking ${event.reference}: ${BOOKING_STATUS_TEXT[event.detail ?? ''] ?? event.detail}`;
    case 'clock_review':
    case 'clock_event_failed':
      return clockLine(event);
    case 'refund':
      return `Refund of ${event.detail} for booking ${event.reference}`;
    default:
      return event.detail ?? event.kind;
  }
}

function hotelLabel(event: AlertEvent): string {
  const names = [event.tenantName, event.propertyName].filter(Boolean);
  if (names.length === 2 && names[0] === names[1]) return names[0]!;
  return names.join(' / ') || 'Unknown hotel';
}

/** One plain-text line describing an event for the system owner (names the hotel). */
export function platformAlertLine(event: AlertEvent): string {
  switch (event.kind) {
    case 'new_hotel':
      return `New hotel signed up: ${event.tenantName ?? event.itemId}`;
    case 'email_failed':
      return `${hotelLabel(event)}: email "${event.reference}" ${event.detail}`;
    default:
      return `${hotelLabel(event)}: ${ownerAlertLine(event)}`;
  }
}

/** HH:MM in a time zone, for "when did this happen". */
export function localTime(value: Date, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value);
  try {
    return format(timeZone);
  } catch {
    return `${format('UTC')} UTC`;
  }
}

function listValue(lines: string[]): string {
  if (lines.length <= LIST_LIMIT) return lines.join('\n');
  return [...lines.slice(0, LIST_LIMIT), `and ${lines.length - LIST_LIMIT} more`].join('\n');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function staffEmail(input: {
  to: string;
  brand: MailBrand;
  subject: string;
  heading: string;
  intro: string;
  rowsLabel: string;
  lines: string[];
  dashboardUrl: string | null;
  footerNote: string;
  eventType: string;
}): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const rows = [{ label: input.rowsLabel, value: listValue(input.lines) }];
  const html = renderBrandedEmail({
    subject: input.subject,
    brand: input.brand,
    preheader: input.lines[0] ?? input.intro,
    heading: input.heading,
    content: `<p style="margin:0;">${escapeHtml(input.intro)}</p>`,
    summaryRows: rows,
    summaryHeading: input.rowsLabel,
    cta: input.dashboardUrl ? { url: input.dashboardUrl, label: 'Open dashboard' } : null,
    supportStyle: 'plain',
    supportLinks: [],
    showBrandFooter: false,
    footerNote: escapeHtml(input.footerNote),
    platformFooter: 'MUST Booking Platform',
  });
  const text = [
    input.heading,
    input.intro,
    ...input.lines.map((line) => `- ${line}`),
    ...(input.dashboardUrl ? [`Dashboard: ${input.dashboardUrl}`] : []),
  ].join('\n');
  return {
    eventType: input.eventType,
    to: input.to,
    subject: input.subject,
    html,
    text,
    bookingId: null,
  };
}

/** Owner alert: bookings that need attention and Clock sync problems at one property. */
export function ownerAlertEmail(
  events: AlertEvent[],
  to: string,
  brand: MailBrand,
  timeZone: string,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'your property';
  const first = events[0]!;
  const subject =
    events.length === 1
      ? `Action needed at ${hotel}: ${ownerAlertLine(first)}`.slice(0, 200)
      : `Action needed at ${hotel}: ${plural(events.length, 'problem')}`;
  return staffEmail({
    to,
    brand,
    subject,
    heading: 'Something needs your attention',
    intro: `${events.length === 1 ? 'This problem was' : 'These problems were'} found at ${hotel} in the last few minutes.`,
    rowsLabel: 'Problems',
    lines: events.map(
      (event) => `${localTime(event.occurredAt, timeZone)} · ${ownerAlertLine(event)}`,
    ),
    dashboardUrl,
    footerNote: `You get these alerts for ${hotel}. You can turn them off in the property's email settings.`,
    eventType: 'owner.alert',
  });
}

/** Owner alert: refunds made at one property. */
export function refundAlertEmail(
  events: AlertEvent[],
  to: string,
  brand: MailBrand,
  timeZone: string,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const hotel = brand.name || 'your property';
  const first = events[0]!;
  const subject =
    events.length === 1
      ? `${hotel}: refund of ${first.detail} for booking ${first.reference}`
      : `${hotel}: ${plural(events.length, 'refund')} made`;
  return staffEmail({
    to,
    brand,
    subject,
    heading: events.length === 1 ? 'A refund was made' : 'Refunds were made',
    intro: `The guest${events.length === 1 ? ' gets' : 's get'} the money back through the original payment method.`,
    rowsLabel: 'Refunds',
    lines: events.map(
      (event) => `${localTime(event.occurredAt, timeZone)} · ${ownerAlertLine(event)}`,
    ),
    dashboardUrl,
    footerNote: `You get these emails for ${hotel}. You can turn them off in the property's email settings.`,
    eventType: 'owner.refund_alert',
  });
}

/** System owner alert: problems across all hotels, and new signups. */
export function platformAlertEmail(
  events: AlertEvent[],
  to: string,
  timeZone: string,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const problems = events.filter((event) => event.kind !== 'new_hotel');
  const signups = events.length - problems.length;
  const parts = [
    ...(problems.length ? [plural(problems.length, 'problem')] : []),
    ...(signups ? [plural(signups, 'new hotel')] : []),
  ];
  const subject =
    events.length === 1
      ? `MUST alert: ${platformAlertLine(events[0]!)}`.slice(0, 200)
      : `MUST alert: ${parts.join(', ')}`;
  return staffEmail({
    to,
    brand: MUST_BOOKING_BRAND,
    subject,
    heading: problems.length ? 'Platform alert' : 'New hotel signup',
    intro: 'Found by the platform in the last few minutes.',
    rowsLabel: 'Events',
    lines: events.map(
      (event) => `${localTime(event.occurredAt, timeZone)} · ${platformAlertLine(event)}`,
    ),
    dashboardUrl,
    footerNote:
      'You get these alerts as the MUST system owner (PLATFORM_ALERT_EMAIL on the server).',
    eventType: 'platform.alert',
  });
}

/** System owner's morning summary of the whole platform for one day. */
export function platformDailySummaryEmail(
  stats: PlatformDailyStats,
  day: string,
  to: string,
  dashboardUrl: string | null,
): Omit<RenderedEmailCommand, 'idempotencyKey'> {
  const subject = `MUST daily summary for ${longDate(day)}: ${plural(stats.bookings, 'new booking')}`;
  const rows = [
    { label: 'Hotels', value: `${stats.hotels} (${plural(stats.properties, 'property')})` },
    { label: 'New hotels', value: String(stats.newHotels) },
    { label: 'New direct bookings', value: String(stats.bookings) },
    { label: 'Cancellations', value: String(stats.cancellations) },
    { label: 'Emails sent', value: String(stats.emailsSent) },
    { label: 'Emails failed or bounced', value: String(stats.emailsFailed) },
    { label: 'Clock updates that failed', value: String(stats.clockEventsFailed) },
    { label: 'Open Clock checks (all time)', value: String(stats.openReviews) },
  ];
  const html = renderBrandedEmail({
    subject,
    brand: MUST_BOOKING_BRAND,
    preheader: `${plural(stats.bookings, 'new booking')}, ${plural(stats.emailsFailed, 'failed email')}.`,
    eyebrow: longDate(day),
    heading: 'Platform summary',
    content: '<p style="margin:0;">Here is what happened across all hotels yesterday.</p>',
    summaryRows: rows,
    summaryHeading: 'Yesterday',
    cta: dashboardUrl ? { url: dashboardUrl, label: 'Open dashboard' } : null,
    supportStyle: 'plain',
    supportLinks: [],
    showBrandFooter: false,
    footerNote: 'You get this summary as the MUST system owner.',
    platformFooter: 'MUST Booking Platform',
  });
  const text = [
    `MUST platform summary — ${longDate(day)}`,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(dashboardUrl ? [`Dashboard: ${dashboardUrl}`] : []),
  ].join('\n');
  return { eventType: 'platform.daily_summary', to, subject, html, text, bookingId: null };
}
