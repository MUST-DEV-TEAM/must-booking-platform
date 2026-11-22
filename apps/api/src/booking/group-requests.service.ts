import { HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MailBrand } from '@must/domain-contracts';

import { emailBrandExtra } from '../mail/email-brand-columns';
import {
  groupRequestGuestEmail,
  groupRequestHotelEmail,
} from '../mail/group-request-email-content';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { NotificationsService } from '../tenancy/notifications.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { propertyClock } from './booking-rules';
import { parseGroupRequest } from './group-request';

type Context = { tenantId: string; propertyId: string };
const MAX_REQUESTS_PER_ADDRESS_PER_DAY = 3;
type PropertyRow = MailBrand & {
  timezone: string | null;
  groupRequestForm: boolean;
  groupRequestEmail: string | null;
  reservationsEmail: string | null;
};

/** Takes a group request from a guest's website: stores it, notifies the hotel and emails both sides. */
@Injectable()
export class GroupRequestsService {
  private readonly logger = new Logger(GroupRequestsService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  async submit(context: Context, body: unknown): Promise<{ id: string }> {
    const { id, input, brand, hotelAddress } = await this.database.withTenantTransaction(
      context,
      async (tx) => {
        const rows = await tx.$queryRaw<PropertyRow[]>`
          SELECT name, brand_colour AS "brandColour", email_footer_text AS "emailFooterText", terms_url AS "termsUrl",
            logo_url AS "logoUrl", support_email AS "supportEmail", phone, public_website_origin AS "websiteUrl",
            address, timezone, group_request_form AS "groupRequestForm", group_request_email AS "groupRequestEmail",
            reservations_email AS "reservationsEmail", ${emailBrandExtra}
          FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
        `;
        const property = rows[0];
        if (!property) throw new NotFoundException('Hotel not found.');
        // A hotel that did not switch the form on takes no requests through it.
        if (!property.groupRequestForm)
          throw new NotFoundException('This hotel does not take group requests online.');
        const parsed = parseGroupRequest(body, propertyClock(property.timezone).date);
        // One address cannot make the hotel and a stranger's inbox the target of a stream of requests.
        const recent = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM group_requests
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND guest_email = ${parsed.email} AND created_at > now() - interval '1 day'
        `;
        if ((recent[0]?.count ?? 0) >= MAX_REQUESTS_PER_ADDRESS_PER_DAY)
          throw new HttpException(
            'You have already sent several requests today. The hotel will reply to your email.',
            429,
          );
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO group_requests (tenant_id, property_id, guest_name, guest_email, guest_phone, organisation,
            starts_on, ends_on, adults, children, rooms, message, language)
          VALUES (${context.tenantId}::uuid, ${context.propertyId}::uuid, ${parsed.name}, ${parsed.email},
            ${parsed.phone}, ${parsed.organisation}, ${parsed.startsOn}::date, ${parsed.endsOn}::date,
            ${parsed.adults}, ${parsed.children}, ${parsed.rooms}, ${parsed.message}, ${parsed.language})
          RETURNING id
        `;
        const requestId = inserted[0]!.id;
        await this.notifications.recordInTransaction(tx, {
          ...context,
          type: 'GROUP_REQUEST_RECEIVED',
          payload: {
            requestId,
            guestName: parsed.name,
            startsOn: parsed.startsOn,
            endsOn: parsed.endsOn,
            guests: parsed.adults + parsed.children,
            rooms: parsed.rooms,
            summary: `${parsed.name}, ${parsed.adults + parsed.children} guests, ${parsed.rooms} rooms, ${parsed.startsOn} to ${parsed.endsOn}`,
          },
        });
        return {
          id: requestId,
          input: parsed,
          brand: property as MailBrand,
          hotelAddress:
            property.groupRequestEmail ||
            property.reservationsEmail ||
            property.supportEmail ||
            null,
        };
      },
    );
    // Email never fails the request: it is already stored and the hotel is notified in the dashboard.
    await this.sendEmails(context, id, input, brand, hotelAddress);
    return { id };
  }

  private async sendEmails(
    context: Context,
    id: string,
    input: ReturnType<typeof parseGroupRequest>,
    brand: MailBrand,
    hotelAddress: string | null,
  ): Promise<void> {
    try {
      if (hotelAddress)
        await this.delivery.dispatch(
          'rendered',
          {
            ...groupRequestHotelEmail(brand, input, hotelAddress, this.dashboardUrl(context)),
            idempotencyKey: `group-request/${id}/hotel`,
          },
          context,
        );
      else
        this.logger.warn(
          `Group request ${id} has no hotel address to email; it is in the dashboard only.`,
        );
      await this.delivery.dispatch(
        'rendered',
        { ...groupRequestGuestEmail(brand, input), idempotencyKey: `group-request/${id}/guest` },
        context,
      );
    } catch (error) {
      this.logger.error(
        `Could not send the emails for group request ${id}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private dashboardUrl(context: Context): string | null {
    const base = process.env.WEB_APP_URL;
    return base
      ? `${base.replace(/\/$/, '')}/dashboard/${context.tenantId}?propertyId=${context.propertyId}&section=notifications`
      : null;
  }
}
