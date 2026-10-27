import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MailBrand } from '@must/domain-contracts';

import { bookingContactSql } from '../booking/booking-contact';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { renderBrandedEmail } from './email-layout';
import {
  renderTemplate,
  savedTemplate,
  stayTemplateValues,
  type EmailTemplateKey,
  type TemplateValues,
} from './email-templates';
import { MailDeliveryService } from './mail-delivery.service';
import {
  guestNotificationEnabled,
  staffDeliveryGroups,
  staffRecipients,
} from './notification-recipients';
import type { NotificationTopic } from './notification-topics';

type Context = { tenantId: string; propertyId: string };
type Row = { label: string; value: string };

type Facts = {
  id: string;
  reference: string;
  email: string | null;
  guestName: string;
  startsOn: string;
  endsOn: string;
  roomName: string;
  guestCount: number;
  currency: string;
  nightlyRates: { date: string; amount: string }[] | null;
};

type BrandFacts = MailBrand & { checkInTime: string | null };

/** What one lifecycle email needs besides the booking: which topic gates it and what it says. */
export interface LifecycleEmail {
  /** The notification topic the hotel can switch off or route (see notification-topics). */
  topic: NotificationTopic;
  /** The editable template that supplies the subject and wording. */
  key: EmailTemplateKey;
  /** Shown in the email log, for example `payment.received`. */
  eventType: string;
  /** The same event must never send twice; the staff version adds the recipient to it. */
  idempotencyKey: string;
  bookingId: string;
  heading: string;
  /** Values the template can use beyond the stay (for example `payment_amount`). */
  values?: TemplateValues;
  /** Extra lines in the summary box, after the booking reference and stay. */
  rows?: Row[];
}

/**
 * Emails about what happened to one booking: money received, a change made by the hotel, and so on. Each is
 * written from the hotel's editable template, gated by its notification topic, logged and queued like every
 * other email. Neither method ever throws: an email problem must not fail the payment or booking itself.
 */
@Injectable()
export class LifecycleEmailService {
  private readonly logger = new Logger(LifecycleEmailService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  /** The guest's email. Skipped when the hotel switched it off or the booking has no email address. */
  async guest(context: Context, email: LifecycleEmail): Promise<void> {
    try {
      const work = await this.database.withTenantTransaction(context, async (tx) => {
        if (!(await guestNotificationEnabled(tx, context, email.topic))) return null;
        const facts = await this.facts(tx, context, email.bookingId);
        if (!facts?.email) return null;
        return {
          facts,
          brand: await this.brand(tx, context),
          template: await savedTemplate(tx, context, email.key),
        };
      });
      if (!work) return;
      const message = this.message(email, work.facts, work.brand, work.template);
      await this.delivery.dispatch(
        'rendered',
        {
          to: work.facts.email!,
          subject: message.subject,
          text: message.text,
          html: this.html(email, work.facts, work.brand, message, null),
          idempotencyKey: email.idempotencyKey,
          eventType: email.eventType,
          bookingId: work.facts.id,
        },
        context,
      );
    } catch (error) {
      this.logger.error(
        `Could not send the ${email.eventType} email to the guest for booking ${email.bookingId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** The staff email, to whoever the hotel routed the topic to (assigned staff, owners, extra addresses). */
  async staff(context: Context, email: LifecycleEmail): Promise<void> {
    try {
      const work = await this.database.withTenantTransaction(context, async (tx) => {
        const recipients = staffDeliveryGroups(await staffRecipients(tx, context, email.topic));
        if (!recipients.length) return null;
        const facts = await this.facts(tx, context, email.bookingId);
        if (!facts) return null;
        return {
          recipients,
          facts,
          brand: await this.brand(tx, context),
          template: await savedTemplate(tx, context, email.key),
        };
      });
      if (!work) return;
      const message = this.message(email, work.facts, work.brand, work.template);
      const dashboard = this.dashboardUrl(context);
      for (const recipient of work.recipients) {
        await this.delivery.dispatch(
          'rendered',
          {
            to: recipient.email,
            subject: message.subject,
            text: `${message.text}${dashboard ? `\n\nOpen in MUST: ${dashboard}` : ''}`,
            html: this.html(
              email,
              work.facts,
              work.brand,
              message,
              dashboard ? { url: dashboard, label: 'Open in MUST' } : null,
            ),
            idempotencyKey: `${email.idempotencyKey}/${recipient.staffUserId}`,
            eventType: email.eventType,
            bookingId: work.facts.id,
          },
          context,
          { recipientEnvelope: recipient.envelope },
        );
      }
    } catch (error) {
      this.logger.error(
        `Could not send the ${email.eventType} email to staff for booking ${email.bookingId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private message(
    email: LifecycleEmail,
    facts: Facts,
    brand: BrandFacts,
    template: Awaited<ReturnType<typeof savedTemplate>>,
  ) {
    return renderTemplate(email.key, template, {
      ...stayTemplateValues({
        guestName: facts.guestName,
        hotelName: brand.name || 'the hotel',
        reference: facts.reference,
        startsOn: facts.startsOn,
        endsOn: facts.endsOn,
        roomName: facts.roomName,
        guestCount: facts.guestCount,
        language: template?.language,
        nightlyRates: facts.nightlyRates ?? undefined,
        currency: facts.currency,
        hotelContact: brand.supportEmail ?? brand.phone ?? undefined,
        checkInTime: brand.checkInTime ?? undefined,
        directions: brand.address ?? undefined,
      }),
      ...email.values,
    });
  }

  private html(
    email: LifecycleEmail,
    facts: Facts,
    brand: BrandFacts,
    message: ReturnType<typeof renderTemplate>,
    cta: { url: string; label: string } | null,
  ): string {
    return renderBrandedEmail({
      subject: message.subject,
      brand,
      preheader: message.previewText || message.subject,
      heading: email.heading,
      content: message.html,
      summaryRows: [
        { label: 'Booking reference', value: facts.reference },
        ...(message.hasStayBlock
          ? []
          : [{ label: 'Stay', value: `${facts.startsOn} to ${facts.endsOn}` }]),
        { label: 'Room', value: facts.roomName },
        { label: 'Guests', value: String(facts.guestCount) },
        ...(email.rows ?? []),
      ],
      summaryHeading: 'Booking',
      cta,
    });
  }

  private async facts(tx: TenantTransaction, context: Context, bookingId: string) {
    const rows = await tx.$queryRaw<
      Array<Omit<Facts, 'guestName'> & { firstName: string | null; lastName: string | null }>
    >`
      SELECT b.id::text AS id, b.external_reference AS reference,
        ${bookingContactSql.email} AS email, ${bookingContactSql.firstName} AS "firstName",
        ${bookingContactSql.lastName} AS "lastName",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
        COALESCE(r.name, rt.name) AS "roomName", (b.adults + b.children)::int AS "guestCount",
        rp.currency, b.nightly_rates AS "nightlyRates"
      FROM bookings b
      LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
      JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
      JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.id = ${bookingId}::uuid
    `;
    const row = rows[0];
    if (!row) return null;
    const { firstName, lastName, ...rest } = row;
    return {
      ...rest,
      guestName: [firstName, lastName].filter(Boolean).join(' ').trim() || row.email || 'the guest',
    } as Facts;
  }

  private async brand(tx: TenantTransaction, context: Context): Promise<BrandFacts> {
    const rows = await tx.$queryRaw<BrandFacts[]>`
      SELECT name, brand_colour AS "brandColour", email_footer_text AS "emailFooterText",
        terms_url AS "termsUrl", logo_url AS "logoUrl", support_email AS "supportEmail", phone,
        public_website_origin AS "websiteUrl", address, check_in_time AS "checkInTime"
      FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    return rows[0]!;
  }

  private dashboardUrl(context: Context): string | null {
    const base = process.env.WEB_APP_URL?.trim();
    if (!base) return null;
    try {
      const url = new URL(`/dashboard/${context.tenantId}`, base);
      url.searchParams.set('propertyId', context.propertyId);
      url.searchParams.set('section', 'reservations');
      return url.toString();
    } catch {
      return null;
    }
  }
}
