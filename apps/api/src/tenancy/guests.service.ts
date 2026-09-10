import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';

export type GuestDirectoryEntry = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  bookingCount: number;
  mostRecentStartsOn: string;
  mostRecentEndsOn: string;
};

export type GuestReviewProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  bookingCount: number;
};

export type SuspectedDuplicatePair = {
  guest: GuestReviewProfile;
  suspectedDuplicate: GuestReviewProfile;
};

type GuestMergeRow = GuestReviewProfile & {
  suspectedDuplicateOfGuestId: string | null;
  mergedIntoGuestId: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class GuestsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(
    tenantId: string,
    propertyId: string,
    search: string | undefined,
  ): Promise<GuestDirectoryEntry[]> {
    const normalizedSearch = search?.trim() ?? '';
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<GuestDirectoryEntry[]>`
        SELECT g.id, g.email, g.first_name AS "firstName", g.last_name AS "lastName", g.phone,
          COUNT(b.id)::int AS "bookingCount",
          recent.starts_on::text AS "mostRecentStartsOn",
          recent.ends_on::text AS "mostRecentEndsOn"
        FROM guests g
        JOIN bookings b
          ON b.tenant_id = g.tenant_id AND b.guest_id = g.id
          AND b.property_id = ${propertyId}::uuid
        JOIN LATERAL (
          SELECT latest.starts_on, latest.ends_on
          FROM bookings latest
          WHERE latest.tenant_id = g.tenant_id AND latest.property_id = ${propertyId}::uuid
            AND latest.guest_id = g.id
          ORDER BY latest.starts_on DESC, latest.created_at DESC, latest.id DESC
          LIMIT 1
        ) recent ON true
        WHERE g.tenant_id = ${tenantId}::uuid
          AND g.merged_into_guest_id IS NULL
          AND (${normalizedSearch} = ''
            OR CONCAT_WS(' ', g.first_name, g.last_name) ILIKE ${`%${normalizedSearch}%`}
            OR g.email ILIKE ${`%${normalizedSearch}%`}
            OR COALESCE(g.phone, '') ILIKE ${`%${normalizedSearch}%`})
        GROUP BY g.id, g.email, g.first_name, g.last_name, g.phone, recent.starts_on, recent.ends_on
        ORDER BY recent.starts_on DESC, g.email ASC
      `,
    );
  }

  listSuspectedDuplicates(tenantId: string, propertyId: string): Promise<SuspectedDuplicatePair[]> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          guestId: string;
          guestEmail: string;
          guestFirstName: string | null;
          guestLastName: string | null;
          guestPhone: string | null;
          guestBookingCount: number;
          duplicateId: string;
          duplicateEmail: string;
          duplicateFirstName: string | null;
          duplicateLastName: string | null;
          duplicatePhone: string | null;
          duplicateBookingCount: number;
        }>
      >`
        SELECT flagged.id AS "guestId", flagged.email AS "guestEmail",
          flagged.first_name AS "guestFirstName", flagged.last_name AS "guestLastName",
          flagged.phone AS "guestPhone", flagged_bookings.booking_count::int AS "guestBookingCount",
          candidate.id AS "duplicateId", candidate.email AS "duplicateEmail",
          candidate.first_name AS "duplicateFirstName", candidate.last_name AS "duplicateLastName",
          candidate.phone AS "duplicatePhone", candidate_bookings.booking_count::int AS "duplicateBookingCount"
        FROM guests flagged
        JOIN guests candidate
          ON candidate.tenant_id = flagged.tenant_id
         AND candidate.id = flagged.suspected_duplicate_of_guest_id
         AND candidate.merged_into_guest_id IS NULL
        JOIN LATERAL (
          SELECT COUNT(*) AS booking_count
          FROM bookings b
          WHERE b.tenant_id = flagged.tenant_id AND b.guest_id = flagged.id
        ) flagged_bookings ON TRUE
        JOIN LATERAL (
          SELECT COUNT(*) AS booking_count
          FROM bookings b
          WHERE b.tenant_id = candidate.tenant_id AND b.guest_id = candidate.id
        ) candidate_bookings ON TRUE
        WHERE flagged.tenant_id = ${tenantId}::uuid
          AND flagged.merged_into_guest_id IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM bookings b
              WHERE b.tenant_id = flagged.tenant_id
                AND b.property_id = ${propertyId}::uuid
                AND b.guest_id = flagged.id
            )
            OR EXISTS (
              SELECT 1 FROM bookings b
              WHERE b.tenant_id = candidate.tenant_id
                AND b.property_id = ${propertyId}::uuid
                AND b.guest_id = candidate.id
            )
          )
        ORDER BY flagged.created_at ASC, flagged.id ASC
      `;
      return rows.map((row) => ({
        guest: {
          id: row.guestId,
          email: row.guestEmail,
          firstName: row.guestFirstName,
          lastName: row.guestLastName,
          phone: row.guestPhone,
          bookingCount: Number(row.guestBookingCount),
        },
        suspectedDuplicate: {
          id: row.duplicateId,
          email: row.duplicateEmail,
          firstName: row.duplicateFirstName,
          lastName: row.duplicateLastName,
          phone: row.duplicatePhone,
          bookingCount: Number(row.duplicateBookingCount),
        },
      }));
    });
  }

  async dismissSuspectedDuplicate(
    tenantId: string,
    propertyId: string,
    guestId: string,
    actorUserId: string,
  ): Promise<void> {
    this.assertUuid(guestId, 'guestId');
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const dismissed = await tx.$queryRaw<Array<{ id: string; duplicateId: string }>>`
        UPDATE guests
        SET suspected_duplicate_of_guest_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND id = ${guestId}::uuid
          AND merged_into_guest_id IS NULL
          AND suspected_duplicate_of_guest_id IS NOT NULL
        RETURNING id, suspected_duplicate_of_guest_id AS "duplicateId"
      `;
      if (!dismissed[0]) throw new NotFoundException('Suspected duplicate guest not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'guest.duplicate_dismissed',
        targetType: 'guest',
        targetId: dismissed[0].id,
        details: { suspectedDuplicateOfGuestId: dismissed[0].duplicateId },
      });
    });
  }

  async mergeSuspectedDuplicate(
    tenantId: string,
    propertyId: string,
    flaggedGuestId: string,
    canonicalGuestId: string,
    actorUserId: string,
  ): Promise<{ canonicalGuestId: string; mergedGuestId: string }> {
    this.assertUuid(flaggedGuestId, 'guestId');
    this.assertUuid(canonicalGuestId, 'canonicalGuestId');
    if (flaggedGuestId === canonicalGuestId)
      throw new BadRequestException('Canonical guest must be one of the two different profiles.');

    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const lockedGuests = await tx.$queryRaw<GuestMergeRow[]>`
        SELECT g.id, g.email, g.first_name AS "firstName", g.last_name AS "lastName", g.phone,
          g.suspected_duplicate_of_guest_id AS "suspectedDuplicateOfGuestId",
          g.merged_into_guest_id AS "mergedIntoGuestId",
          0::int AS "bookingCount"
        FROM guests g
        WHERE g.tenant_id = ${tenantId}::uuid
          AND (
            g.id IN (${flaggedGuestId}::uuid, ${canonicalGuestId}::uuid)
            OR g.id = (
              SELECT suspected_duplicate_of_guest_id FROM guests
              WHERE tenant_id = ${tenantId}::uuid AND id = ${flaggedGuestId}::uuid
            )
          )
        ORDER BY g.id
        FOR UPDATE
      `;
      const flagged = lockedGuests.find((guest) => guest.id === flaggedGuestId);
      if (!flagged) throw new NotFoundException('Suspected duplicate guest not found.');
      if (flagged.mergedIntoGuestId)
        throw new ConflictException('The suspected duplicate has already been merged.');
      if (!flagged.suspectedDuplicateOfGuestId)
        throw new ConflictException('Guest is no longer flagged as a suspected duplicate.');

      const candidateId = flagged.suspectedDuplicateOfGuestId;
      const canonicalId = canonicalGuestId;
      const mergedId = canonicalId === flaggedGuestId ? candidateId : flaggedGuestId;
      if (canonicalId !== flaggedGuestId && canonicalId !== candidateId)
        throw new BadRequestException('Canonical guest must be one of the flagged profiles.');
      const canonical = lockedGuests.find((guest) => guest.id === canonicalId);
      const merged = lockedGuests.find((guest) => guest.id === mergedId);
      if (!canonical || !merged)
        throw new ConflictException('The suspected duplicate profiles are no longer available.');
      if (canonical.mergedIntoGuestId || merged.mergedIntoGuestId)
        throw new ConflictException('The suspected duplicate has already been merged.');

      // Payments are booking-scoped, not guest-scoped, so their history follows
      // the booking when its guest foreign key is reassigned below.
      const movedBookingCount = await tx.$executeRaw`
        UPDATE bookings
        SET guest_id = ${canonicalId}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND guest_id = ${mergedId}::uuid
      `;

      await tx.$executeRaw`
        UPDATE guests canonical
        SET email = COALESCE(NULLIF(BTRIM(canonical.email), ''), NULLIF(BTRIM(merged.email), '')),
          first_name = COALESCE(NULLIF(BTRIM(canonical.first_name), ''), NULLIF(BTRIM(merged.first_name), '')),
          last_name = COALESCE(NULLIF(BTRIM(canonical.last_name), ''), NULLIF(BTRIM(merged.last_name), '')),
          phone = COALESCE(NULLIF(BTRIM(canonical.phone), ''), NULLIF(BTRIM(merged.phone), '')),
          street_address = COALESCE(NULLIF(BTRIM(canonical.street_address), ''), NULLIF(BTRIM(merged.street_address), '')),
          address_line_2 = COALESCE(NULLIF(BTRIM(canonical.address_line_2), ''), NULLIF(BTRIM(merged.address_line_2), '')),
          city = COALESCE(NULLIF(BTRIM(canonical.city), ''), NULLIF(BTRIM(merged.city), '')),
          county = COALESCE(NULLIF(BTRIM(canonical.county), ''), NULLIF(BTRIM(merged.county), '')),
          postcode = COALESCE(NULLIF(BTRIM(canonical.postcode), ''), NULLIF(BTRIM(merged.postcode), '')),
          updated_at = CURRENT_TIMESTAMP
        FROM guests merged
        WHERE canonical.tenant_id = ${tenantId}::uuid AND canonical.id = ${canonicalId}::uuid
          AND merged.tenant_id = ${tenantId}::uuid AND merged.id = ${mergedId}::uuid
      `;

      // Any outstanding pointer to the losing record can safely follow the
      // canonical record; the pair itself is removed from the review queue.
      await tx.$executeRaw`
        UPDATE guests
        SET suspected_duplicate_of_guest_id = CASE
            WHEN id IN (${canonicalId}::uuid, ${mergedId}::uuid) THEN NULL
            WHEN suspected_duplicate_of_guest_id = ${mergedId}::uuid THEN ${canonicalId}::uuid
            ELSE suspected_duplicate_of_guest_id
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid
          AND (
            id IN (${canonicalId}::uuid, ${mergedId}::uuid)
            OR suspected_duplicate_of_guest_id IN (${canonicalId}::uuid, ${mergedId}::uuid)
          )
      `;

      await tx.$executeRaw`
        UPDATE guests
        SET merged_into_guest_id = ${canonicalId}::uuid,
            suspected_duplicate_of_guest_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND id = ${mergedId}::uuid
      `;

      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'guest.merged',
        targetType: 'guest',
        targetId: canonicalId,
        details: { mergedGuestId: mergedId, movedBookingCount },
      });

      return { canonicalGuestId: canonicalId, mergedGuestId: mergedId };
    });
  }

  private assertUuid(value: string, name: string): void {
    if (!uuidPattern.test(value)) throw new BadRequestException(`${name} must be a UUID.`);
  }
}
