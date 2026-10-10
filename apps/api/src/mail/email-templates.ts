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
] as const;

export const EMAIL_TEMPLATES = {
  booking_confirmed: {
    label: 'Booking confirmed',
    placeholders: [...COMMON, 'payment_note'],
    subject: '{hotel_name} booking confirmed — {booking_reference}',
    body: 'Hello {guest_name}, thank you for choosing {hotel_name}. Your reservation is confirmed. {payment_note}',
  },
  booking_cancelled: {
    label: 'Booking cancelled',
    placeholders: [...COMMON],
    subject: 'Booking {booking_reference} cancelled',
    body: "Hello {guest_name}, your booking has been cancelled as requested. If you need help planning a new stay, we're here for you.",
  },
  refund_processed: {
    label: 'Refund processed',
    placeholders: [...COMMON, 'refund_amount'],
    subject: '{hotel_name} refund processed — {booking_reference}',
    body: 'Hello {guest_name}, your refund of {refund_amount} has been processed. It may take a few business days to appear on your original payment method.',
  },
  pre_arrival: {
    label: 'Pre-arrival reminder',
    placeholders: [...COMMON],
    subject: 'See you soon at {hotel_name} — {check_in}',
    body: 'Hello {guest_name}, we look forward to welcoming you at {hotel_name} on {check_in}. Simply reply to this email if you have any questions before you arrive.',
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
} as const satisfies Record<
  string,
  { label: string; placeholders: readonly string[]; subject: string; body: string }
>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export type TemplateValues = Partial<Record<string, string>>;
export type SavedTemplate = { subject: string; body: string };
/** What a template contributes to an email: the subject and the message block. */
export type RenderedTemplate = { subject: string; html: string; text: string };

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
  const source = saved ?? EMAIL_TEMPLATES[key];
  const subject = fill(source.subject, values, (value) => value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const paragraphs = source.body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const html = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px 0;">${fill(escapeHtml(paragraph), values, escapeHtml).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const text = paragraphs
    .map((paragraph) => fill(paragraph, values, (value) => value))
    .join('\n\n');
  return { subject, html, text };
}

/** The property's saved wording for an email, or null to use the default. */
export async function savedTemplate(
  tx: TenantTransaction,
  context: { tenantId: string; propertyId: string },
  key: EmailTemplateKey,
): Promise<SavedTemplate | null> {
  const rows = await tx.$queryRaw<SavedTemplate[]>`
    SELECT subject, body FROM email_templates
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND template_key = ${key} AND language = ${TEMPLATE_LANGUAGE}
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
}): TemplateValues {
  return {
    guest_name: input.guestName,
    hotel_name: input.hotelName,
    booking_reference: input.reference,
    check_in: longDate(input.startsOn),
    check_out: longDate(input.endsOn),
    nights: String(nights(input.startsOn, input.endsOn)),
    room: input.roomName,
    guests: String(input.guestCount),
  };
}
