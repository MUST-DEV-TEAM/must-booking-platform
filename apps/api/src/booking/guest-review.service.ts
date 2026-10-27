import { Prisma } from '@prisma/client';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { bookingContactSql } from './booking-contact';
import {
  REVIEW_CATEGORIES,
  REVIEW_LINK_VALID_DAYS,
  hashReviewToken,
  newReviewToken,
  parseReviewSubmission,
} from './guest-review';

type Scope = { tenantId: string; propertyId: string };

type ReviewRow = {
  id: string;
  submittedAt: Date;
  overall: number;
  cleanliness: number | null;
  staff: number | null;
  location: number | null;
  comfort: number | null;
  food: number | null;
  valueForMoney: number | null;
  comment: string | null;
  bookingId: string;
  reference: string;
  startsOn: string;
  endsOn: string;
  roomName: string;
  guestId: string | null;
  guestName: string | null;
  guestEmail: string | null;
};

const REVIEW_SELECT = Prisma.sql`
  SELECT r.id::text AS id, r.submitted_at AS "submittedAt", r.overall, r.cleanliness, r.staff, r.location,
    r.comfort, r.food, r.value_for_money AS "valueForMoney", r.comment,
    b.id::text AS "bookingId", b.external_reference AS reference,
    b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
    COALESCE(rm.name, rt.name) AS "roomName", b.guest_id::text AS "guestId",
    NULLIF(TRIM(CONCAT_WS(' ', ${bookingContactSql.firstName}, ${bookingContactSql.lastName})), '') AS "guestName",
    ${bookingContactSql.email} AS "guestEmail"
  FROM guest_reviews r
  JOIN bookings b ON b.tenant_id = r.tenant_id AND b.property_id = r.property_id AND b.id = r.booking_id
  JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
  LEFT JOIN rooms rm ON rm.tenant_id = b.tenant_id AND rm.property_id = b.property_id AND rm.id = b.room_id
  LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
`;

function toItem(row: ReviewRow) {
  return {
    id: row.id,
    submittedAt: row.submittedAt.toISOString(),
    overall: row.overall,
    categories: {
      cleanliness: row.cleanliness,
      staff: row.staff,
      location: row.location,
      comfort: row.comfort,
      food: row.food,
      valueForMoney: row.valueForMoney,
    } as Record<string, number | null>,
    comment: row.comment,
    booking: {
      id: row.bookingId,
      reference: row.reference,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      roomName: row.roomName,
    },
    guest: row.guestId
      ? { id: row.guestId, name: row.guestName, email: row.guestEmail }
      : row.guestName || row.guestEmail
        ? { id: null, name: row.guestName, email: row.guestEmail }
        : null,
  };
}

/** The private "how was your stay" page: one link and one review per stay, collected for the hotel only. */
@Injectable()
export class GuestReviewService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /**
   * Makes the private link for a stay and returns the address to put in the email, or null when the guest
   * already reviewed it. Only a hash of the link is stored. Call it only when the email has not been sent yet:
   * a new link replaces an unused earlier one.
   */
  async invite(scope: Scope, bookingId: string): Promise<string | null> {
    const base = process.env.WEB_APP_URL?.trim();
    if (!base) return null;
    const { token, hash } = newReviewToken();
    const created = await this.database.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO guest_reviews (tenant_id, property_id, booking_id, token_hash, expires_at)
        VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${bookingId}::uuid, ${hash},
          now() + ${REVIEW_LINK_VALID_DAYS} * interval '1 day')
        ON CONFLICT (tenant_id, booking_id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
          invited_at = now(), expires_at = EXCLUDED.expires_at
        WHERE guest_reviews.submitted_at IS NULL
        RETURNING id
      `;
      return rows.length > 0;
    });
    if (!created) return null;
    const url = new URL('/review', base);
    url.searchParams.set('tenant', scope.tenantId);
    url.searchParams.set('property', scope.propertyId);
    url.searchParams.set('token', token);
    return url.toString();
  }

  /** What the page needs to show: the hotel, the stay, the aspects to rate. */
  async form(scope: Scope, token: string | undefined) {
    const row = await this.find(scope, token);
    return {
      hotel: {
        name: row.hotelName,
        logoUrl: row.logoUrl,
        brandColour: row.brandColour,
        websiteUrl: row.websiteUrl,
      },
      guestFirstName: row.guestFirstName,
      stay: { startsOn: row.startsOn, endsOn: row.endsOn },
      categories: REVIEW_CATEGORIES.map(({ key, label }) => ({ key, label })),
      alreadySubmitted: !!row.submittedAt,
    };
  }

  async submit(scope: Scope, token: string | undefined, body: unknown) {
    const row = await this.find(scope, token);
    if (row.submittedAt)
      throw new ConflictException('Thank you, we already have your review for this stay.');
    const review = parseReviewSubmission(body);
    const c = review.categories;
    const saved = await this.database.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE guest_reviews SET submitted_at = now(), overall = ${review.overall},
          cleanliness = ${c.cleanliness ?? null}, staff = ${c.staff ?? null},
          location = ${c.location ?? null}, comfort = ${c.comfort ?? null}, food = ${c.food ?? null},
          value_for_money = ${c.valueForMoney ?? null}, comment = ${review.comment}
        WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
          AND token_hash = ${hashReviewToken(token!)} AND submitted_at IS NULL AND expires_at > now()
        RETURNING id
      `;
      return rows.length > 0;
    });
    // Two submits at once: only the first one updates the row.
    if (!saved)
      throw new ConflictException('Thank you, we already have your review for this stay.');
    return { saved: true };
  }

  /** The hotel's own view: averages and every review in the period, each tied to its stay and guest. */
  async report(scope: Scope, days: number | null) {
    const rows = await this.database.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<ReviewRow[]>`
        ${REVIEW_SELECT}
        WHERE r.tenant_id = ${scope.tenantId}::uuid AND r.property_id = ${scope.propertyId}::uuid
          AND r.submitted_at IS NOT NULL
          AND (${days}::int IS NULL OR r.submitted_at >= now() - ${days ?? 0}::int * interval '1 day')
        ORDER BY r.submitted_at DESC
        LIMIT 500
      `,
    );
    const items = rows.map(toItem);
    const average = (values: Array<number | null>) => {
      const given = values.filter((value): value is number => value !== null);
      return given.length
        ? {
            average: Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 100) / 100,
            count: given.length,
          }
        : null;
    };
    return {
      summary: {
        overall: average(items.map((item) => item.overall)),
        categories: REVIEW_CATEGORIES.map(({ key, label }) => ({
          key,
          label,
          ...(average(items.map((item) => item.categories[key] ?? null)) ?? {
            average: null,
            count: 0,
          }),
        })),
      },
      items,
    };
  }

  /** The review for one reservation, or null when the guest has not left one. */
  async forBooking(scope: Scope, bookingId: string) {
    const rows = await this.database.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<ReviewRow[]>`
        ${REVIEW_SELECT}
        WHERE r.tenant_id = ${scope.tenantId}::uuid AND r.property_id = ${scope.propertyId}::uuid
          AND r.booking_id = ${bookingId}::uuid AND r.submitted_at IS NOT NULL
      `,
    );
    return rows[0] ? toItem(rows[0]) : null;
  }

  private async find(scope: Scope, token: string | undefined) {
    // The same answer for a missing, wrong or unknown link, so links cannot be guessed at.
    if (!token || token.length < 20 || token.length > 100)
      throw new NotFoundException('This review link is not valid.');
    const rows = await this.database.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{
            submittedAt: Date | null;
            expired: boolean;
            hotelName: string;
            logoUrl: string | null;
            brandColour: string | null;
            websiteUrl: string | null;
            guestFirstName: string | null;
            startsOn: string;
            endsOn: string;
          }>
        >`
          SELECT r.submitted_at AS "submittedAt", (r.expires_at <= now()) AS expired,
            p.name AS "hotelName", p.logo_url AS "logoUrl", p.brand_colour AS "brandColour",
            p.public_website_origin AS "websiteUrl",
            COALESCE(b.guest_contact->>'firstName', g.first_name) AS "guestFirstName",
            b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn"
          FROM guest_reviews r
          JOIN bookings b ON b.tenant_id = r.tenant_id AND b.property_id = r.property_id AND b.id = r.booking_id
          JOIN properties p ON p.tenant_id = r.tenant_id AND p.id = r.property_id
          LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          WHERE r.tenant_id = ${scope.tenantId}::uuid AND r.property_id = ${scope.propertyId}::uuid
            AND r.token_hash = ${hashReviewToken(token)}
        `,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('This review link is not valid.');
    if (row.expired && !row.submittedAt)
      throw new GoneException('This review link has expired. Thank you for staying with us.');
    return row;
  }
}
