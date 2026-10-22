import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { escapeHtml } from './email-layout';
import { longDate, nights } from './scheduled-email-content';

/**
 * Guest emails whose wording a property can change (email plan Step 3). The property
 * edits the subject and the message; the branded header, the booking details and the
 * footer stay generated, so a template can never break the layout or leak markup.
 * Placeholders like {guest_name} are filled in when the email is sent; values are
 * escaped, and unknown placeholders are refused when the template is saved.
 */
const COMMON = [
  'guest_name',
  'hotel_name',
  'booking_reference',
  'check_in',
  'check_out',
  'nights',
  'room',
  'guests',
  'hotel_contact',
  'hotel_policies',
  'check_in_time',
  'directions',
  'stay_range',
  'stay_nights',
] as const;

export const EMAIL_TEMPLATES = {
  booking_confirmed: {
    label: 'Booking confirmation - paid online',
    placeholders: [...COMMON, 'payment_note'],
    subject: '{hotel_name} booking confirmed — {booking_reference}',
    body: 'Hello {guest_name}, thank you for choosing {hotel_name}. Your reservation is confirmed. {payment_note}\n\nPlease keep booking reference {booking_reference} for arrival. Check-in starts at {check_in_time}. If your arrival plans change, contact our team.\n\n{hotel_contact}',
  },
  booking_cancelled: {
    label: 'Booking cancelled',
    placeholders: [...COMMON],
    subject: 'Booking {booking_reference} cancelled',
    body: 'Hello {guest_name}, your reservation {booking_reference} at {hotel_name} has been cancelled. The stay details below identify the reservation that was cancelled.\n\nAny refund is confirmed in a separate payment message. If this cancellation was unexpected, contact our team with your booking reference.\n\n{hotel_contact}',
  },
  refund_processed: {
    label: 'Refund processed',
    placeholders: [...COMMON, 'refund_amount'],
    subject: '{hotel_name} refund processed — {booking_reference}',
    body: 'Hello {guest_name}, a refund of {refund_amount} has been processed for reservation {booking_reference} at {hotel_name}.\n\nYour bank or payment provider controls when the funds appear. Keep this message as your refund confirmation. A refund by itself does not cancel your reservation; any cancellation is confirmed separately.\n\n{hotel_contact}',
  },
  pre_arrival: {
    label: 'Pre-arrival reminder',
    placeholders: [...COMMON],
    subject: 'See you soon at {hotel_name} — {check_in}',
    body: 'Hello {guest_name}, we look forward to welcoming you at {hotel_name} on {check_in}. Check-in starts at {check_in_time}.\n\nPlease have booking reference {booking_reference} ready. Let our team know if your arrival time or travel plans have changed.\n\n{directions}\n\n{hotel_policies}\n\n{hotel_contact}',
  },
  booking_changed: {
    label: 'Booking changed',
    placeholders: [...COMMON],
    subject: 'Your booking at {hotel_name} has been updated — {booking_reference}',
    body: '{hotel_name} has updated your booking, {guest_name}. Here are the new details.\n\nIf you did not ask for this change, simply reply to this email.',
  },
  payment_not_completed: {
    label: 'Payment not completed',
    placeholders: [...COMMON],
    subject: 'Your booking at {hotel_name} was not completed',
    body: 'Hello {guest_name}, the payment for your booking at {hotel_name} was not completed in time, so the booking was not made and the room was released. You have not been charged; if a payment still goes through, it is refunded automatically.\n\nStill want to stay with us? You are welcome to book again, or simply reply to this email.',
  },
  post_stay: {
    label: 'Post-stay thank-you',
    placeholders: [...COMMON],
    subject: 'Thank you for staying at {hotel_name}',
    body: 'Hello {guest_name}, thank you for staying with us at {hotel_name}. We hope you enjoyed your stay.\n\nWe would love to hear how it went. If you have a moment, please leave us a review.',
  },
  booking_confirmed_pay_at_hotel: {
    label: 'Booking confirmation - pay at hotel',
    placeholders: [...COMMON, 'payment_note'],
    subject: 'Your stay at {hotel_name} is confirmed - {booking_reference}',
    body: 'Hello {guest_name}, your reservation at {hotel_name} is confirmed. {payment_note}\n\n{stay_range}\n\n{hotel_policies}\n\nQuestions? {hotel_contact}',
  },
  payment_pending: {
    label: 'Payment link / payment pending',
    placeholders: [...COMMON, 'payment_link', 'payment_due'],
    subject: 'Complete your booking at {hotel_name}',
    body: 'Hello {guest_name}, please complete payment of {payment_due} using {payment_link}. Your booking is awaiting payment.\n\n{stay_range}\n\n{hotel_contact}',
  },
  payment_reminder: {
    label: 'Payment reminder',
    placeholders: [...COMMON, 'payment_link', 'payment_due'],
    subject: 'Payment reminder - {booking_reference}',
    body: 'Hello {guest_name}, payment of {payment_due} for your stay is still pending. Please use {payment_link}.\n\n{hotel_contact}',
  },
  payment_link_expiring: {
    label: 'Payment link expiring',
    placeholders: [...COMMON, 'payment_link', 'expires_at'],
    subject: 'Your payment link expires soon - {booking_reference}',
    body: 'Hello {guest_name}, your payment link expires at {expires_at}. Complete payment at {payment_link} to keep your reservation.\n\n{hotel_contact}',
  },
  payment_received: {
    label: 'Payment received / receipt',
    placeholders: [...COMMON, 'payment_amount'],
    subject: 'Payment received - {booking_reference}',
    body: 'Hello {guest_name}, we received your payment of {payment_amount}. Thank you.\n\n{stay_range}\n\n{hotel_contact}',
  },
  payment_failed: {
    label: 'Payment failed',
    placeholders: [...COMMON],
    subject: 'Payment could not be completed - {booking_reference}',
    body: 'Hello {guest_name}, we could not complete your payment. Contact {hotel_contact} for help. Please check your reservation status before trying again.',
  },
  check_in_day: {
    label: 'Check-in day message',
    placeholders: [...COMMON],
    subject: 'Welcome to {hotel_name} today',
    body: 'Hello {guest_name}, we look forward to welcoming you today. Check-in: {check_in_time}.\n\n{directions}\n\n{hotel_contact}',
  },
  no_show_notice: {
    label: 'No-show notice',
    placeholders: [...COMMON],
    subject: 'We missed you at {hotel_name} - {booking_reference}',
    body: 'Hello {guest_name}, our team recorded your reservation as a no-show. Please contact {hotel_contact} if your travel plans changed or this is incorrect.\n\n{hotel_policies}',
  },
  staff_new_booking: {
    label: 'New booking - staff',
    placeholders: [...COMMON, 'payment_note'],
    subject: 'New booking - {booking_reference}',
    body: 'A new reservation is confirmed for {guest_name}.\n\n{stay_range}\n{room} - {guests} guests\n{payment_note}\n\nOpen the reservation in MUST to review the details.',
  },
  staff_booking_changed: {
    label: 'Booking modified - staff',
    placeholders: [...COMMON],
    subject: 'Booking updated - {booking_reference}',
    body: 'Reservation {booking_reference} for {guest_name} was updated at {hotel_name}.\n\n{stay_range}\n{room} - {guests} guests\n\nReview the recorded changes, room assignment and any effect on the balance in MUST before contacting the guest.',
  },
  staff_booking_cancelled: {
    label: 'Cancellation - staff',
    placeholders: [...COMMON],
    subject: 'Booking cancelled - {booking_reference}',
    body: 'Reservation {booking_reference} for {guest_name} was cancelled at {hotel_name}.\n\n{stay_range}\n{room} - {guests} guests\n\nReview the cancellation reason, refund decision and provider synchronization result in MUST. A cancellation does not by itself prove that a refund has completed.',
  },
  staff_payment_received: {
    label: 'Payment received - staff',
    placeholders: [...COMMON, 'payment_amount'],
    subject: 'Payment received - {booking_reference}',
    body: 'Payment of {payment_amount} was recorded for reservation {booking_reference}, {guest_name}, at {hotel_name}.\n\n{stay_range}\n{room} - {guests} guests\n\nReview the transaction reference, method and remaining balance in MUST. Payments mirrored to Clock must not be entered a second time.',
  },
  staff_payment_failed: {
    label: 'Payment failed - staff',
    placeholders: [...COMMON],
    subject: 'Payment needs attention - {booking_reference}',
    body: 'A payment for reservation {booking_reference} could not be completed. Review the payment status in MUST before taking further action.',
  },
  staff_refund_processed: {
    label: 'Refund made - staff and owner',
    placeholders: [...COMMON, 'refund_amount'],
    subject: 'Refund recorded - {booking_reference}',
    body: 'A refund of {refund_amount} was recorded for reservation {booking_reference}, {guest_name}, at {hotel_name}.\n\n{stay_range}\n\nReview the original payment, refund reference, staff note and Clock synchronization result in MUST. Confirm the booking status separately if cancellation was also requested.',
  },
  owner_alerts: {
    label: 'Sync problem / needs attention',
    placeholders: ['hotel_name', 'hotel_contact', 'alert_summary'],
    subject: 'Action needed at {hotel_name}',
    body: '{alert_summary}\n\nOpen Needs attention in MUST to review the recorded issue. Do not repeat a provider operation until its outcome is known.',
  },
  owner_daily_summary: {
    label: 'Daily summary',
    placeholders: ['hotel_name', 'hotel_contact', 'summary_date', 'summary'],
    subject: 'Daily summary - {hotel_name} - {summary_date}',
    body: 'Here is the recorded activity for {hotel_name}.\n\n{summary}\n\nOpen MUST for the current details.',
  },
  owner_weekly_summary: {
    label: 'Weekly summary',
    placeholders: ['hotel_name', 'hotel_contact', 'summary_date', 'summary'],
    subject: 'Weekly summary - {hotel_name} - {summary_date}',
    body: 'Here is the recorded weekly activity for {hotel_name}.\n\n{summary}\n\nOpen Reports in MUST for the full figures.',
  },
  staff_invitation: {
    label: 'Staff invitation',
    placeholders: ['hotel_name', 'staff_name', 'invitation_link', 'role_name'],
    subject: 'You are invited to {hotel_name}',
    body: 'Hello {staff_name}, you have been invited to join {hotel_name} as {role_name}. Use your secure invitation link: {invitation_link}. If you did not expect this invitation, contact the hotel.',
  },
  staff_account_created: {
    label: 'Staff account created',
    placeholders: ['hotel_name', 'staff_name', 'staff_email', 'sign_in_link'],
    subject: 'Your {hotel_name} staff account is ready',
    body: 'Hello {staff_name}, your staff account ({staff_email}) is ready. Sign in at {sign_in_link}. Your password is never included in this email. Contact your hotel administrator if you need help.',
  },
} as const satisfies Record<
  string,
  { label: string; placeholders: readonly string[]; subject: string; body: string }
>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export type TemplateValues = Partial<Record<string, string>>;
export type SavedTemplate = {
  subject: string;
  body: string;
  previewText?: string;
  language?: string;
};
/** What a template contributes to an email: the subject and the message block. */
export type RenderedTemplate = {
  subject: string;
  html: string;
  text: string;
  previewText?: string;
  hasStayBlock?: boolean;
};

export const TEMPLATE_LANGUAGE = 'en';
export const MAX_SUBJECT_LENGTH = 300;
export const MAX_BODY_LENGTH = 5000;
const PLACEHOLDER = /\{([a-z_]+)\}/g;

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return Object.hasOwn(EMAIL_TEMPLATES, value);
}

/** Placeholders a template uses that this email does not know. */
export function unknownPlaceholders(key: EmailTemplateKey, ...texts: string[]): string[] {
  const allowed = new Set<string>(EMAIL_TEMPLATES[key].placeholders);
  const unknown = new Set<string>();
  for (const text of texts)
    for (const match of text.matchAll(PLACEHOLDER))
      if (!allowed.has(match[1]!)) unknown.add(match[1]!);
  return [...unknown];
}

/** Clear hotel-branded default wording; stored custom text remains untouched. */
export function defaultTemplate(key: EmailTemplateKey): SavedTemplate {
  const source = EMAIL_TEMPLATES[key];
  let body: string = source.body;
  if (!key.startsWith('staff_') && !key.startsWith('owner_')) {
    if (!body.includes('{hotel_contact}')) body += '\n\nQuestions? {hotel_contact}';
    if (
      [
        'booking_confirmed',
        'booking_cancelled',
        'refund_processed',
        'pre_arrival',
        'booking_changed',
        'post_stay',
      ].includes(key) &&
      !body.includes('{stay_range}')
    )
      body += '\n\n{stay_range}';
    if (
      ['booking_confirmed', 'booking_cancelled'].includes(key) &&
      !body.includes('{hotel_policies}')
    )
      body += '\n\n{hotel_policies}';
    if (key === 'pre_arrival') body += '\n\nCheck-in: {check_in_time}\n{directions}';
  }
  return { subject: source.subject, body, previewText: '' };
}

function fill(text: string, values: TemplateValues, escape: (value: string) => string): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : escape(value);
  });
}

/**
 * Fills a template (the property's saved one, else the default). The message becomes
 * paragraphs at blank lines and line breaks within them; everything is escaped.
 */
export function renderTemplate(
  key: EmailTemplateKey,
  saved: SavedTemplate | null,
  values: TemplateValues,
): RenderedTemplate {
  const source = saved ?? defaultTemplate(key);
  const subject = fill(source.subject, values, (value) => value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const paragraphs = source.body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const html = paragraphs
    .map((paragraph) =>
      paragraph.trim() === '{stay_nights}' && values.stay_nights
        ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px 0"><thead><tr><th scope="col" style="text-align:left">Date</th><th scope="col" style="text-align:right">Nightly rate</th></tr></thead><tbody>${values.stay_nights
            .split('\n')
            .map((line) => {
              const [date, ...details] = line.split(' - ');
              return `<tr><td style="padding:6px 0">${escapeHtml(date ?? '')}</td><td style="padding:6px 0;text-align:right">${escapeHtml(details.join(' - '))}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : `<p style="margin:0 0 18px 0;">${fill(escapeHtml(paragraph), values, escapeHtml).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const text = paragraphs
    .map((paragraph) => fill(paragraph, values, (value) => value))
    .join('\n\n');
  const previewText = fill(saved?.previewText ?? '', values, (v) => v)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return {
    subject,
    html,
    text,
    hasStayBlock: /\{stay_(range|nights)\}/.test(source.body),
    ...(previewText ? { previewText } : {}),
  };
}

/** The property's saved wording for an email, or null to use the default. */
export async function savedTemplate(
  tx: TenantTransaction,
  context: { tenantId: string; propertyId: string },
  key: EmailTemplateKey,
): Promise<SavedTemplate | null> {
  const rows = await tx.$queryRaw<SavedTemplate[]>`
    SELECT subject, body,language, preview_text AS "previewText" FROM email_templates
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND template_key = ${key} AND language IN ('en',(SELECT email_default_language FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid))
    ORDER BY CASE WHEN language=(SELECT email_default_language FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid) THEN 0 ELSE 1 END LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The placeholder values every guest email shares. */
export function stayTemplateValues(input: {
  guestName: string;
  hotelName: string;
  reference: string;
  startsOn: string;
  endsOn: string;
  roomName: string;
  guestCount: number;
  language?: string;
  hotelContact?: string;
  policies?: string;
  checkInTime?: string;
  directions?: string;
  roomNightlyRates?: readonly {
    roomName: string;
    currency: string;
    nightlyRates: readonly { date: string; amount: string }[] | null;
  }[];
  nightlyRates?: readonly { date: string; amount: string }[];
  currency?: string;
}): TemplateValues {
  const date = (value: string) =>
    new Intl.DateTimeFormat(input.language === 'sq' ? 'sq-AL' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      ...(input.startsOn.slice(0, 4) !== input.endsOn.slice(0, 4)
        ? { year: 'numeric' as const }
        : {}),
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  const dates: string[] = [];
  for (let d = input.startsOn; d < input.endsOn && dates.length < 366;) {
    dates.push(d);
    const next = new Date(d + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return {
    hotel_contact: input.hotelContact || 'Contact the hotel',
    hotel_policies:
      input.policies || 'The payment and cancellation terms agreed when booking apply.',
    check_in_time: input.checkInTime || 'Contact the hotel for check-in time',
    directions: input.directions || 'Contact the hotel for directions',
    stay_range: `${date(input.startsOn)} - ${date(input.endsOn)}`,
    stay_nights: dates
      .flatMap((day) =>
        input.roomNightlyRates?.length
          ? input.roomNightlyRates.map(
              (room) =>
                `${date(day)} - ${room.roomName} - ${room.nightlyRates?.find((r) => r.date === day)?.amount ?? 'Not recorded'} ${room.currency}`,
            )
          : [
              `${date(day)} - ${input.nightlyRates?.find((r) => r.date === day)?.amount ?? 'Not recorded'}${input.currency ? ' ' + input.currency : ''}`,
            ],
      )
      .join('\n'),
    guest_name: input.guestName,
    hotel_name: input.hotelName,
    booking_reference: input.reference,
    check_in: input.language === 'sq' ? date(input.startsOn) : longDate(input.startsOn),
    check_out: input.language === 'sq' ? date(input.endsOn) : longDate(input.endsOn),
    nights: String(nights(input.startsOn, input.endsOn)),
    room: input.roomName,
    guests: String(input.guestCount),
  };
}
