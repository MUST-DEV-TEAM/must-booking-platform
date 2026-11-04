import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { VenueDepositRulesService } from './venue-deposit-rules.service';
import { VenueDepositPaymentsService } from '../payments/venue-deposit-payments.service';
import { depositMinor } from './venue-deposit-policy';
import { publicBookingAllowed, type LifecycleState } from '../platform/console/hotel-lifecycle';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { loadVenuePlan, requireDining } from './venue-plan';
import {
  isoWeekday,
  newReservationReference,
  pickBestTable,
  slotTimes,
  tableStatusAt,
  type BookingStatus,
  type TableStatus,
} from './venue-reservation-logic';
import {
  parseAvailabilityQuery,
  parseFloorQuery,
  parseListQuery,
  parseReservationCreate,
  parseReservationUpdate,
  parseStatusChange,
  type ReservationUpdate,
  type SettableStatus,
} from './venue-reservation-input';

type VenueSettings = {
  id: string;
  propertyId: string | null;
  holdMinutes: number;
  active: boolean;
  timezone: string | null;
  setupCompletedAt: Date | null;
  diningMinutes: number;
  advanceBookingDays: number;
  maxOnlinePartySize: number;
  lastBookingMinutesBeforeClose: number;
};

type TableRow = {
  id: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  areaId: string;
  areaName: string;
  priority: number;
};

export type ReservationView = {
  id: string;
  reference: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  guestId: string | null;
  notes: string | null;
  source: string;
  seatedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  tables: Array<{ id: string; label: string; areaId: string; areaName: string }>;
  /** The hotel stay of this guest around the booking, so staff can greet an in-house guest. */
  stay: { bookingId: string; startsOn: string; endsOn: string; room: string | null } | null;
};

// Fixed column list, embedded as SQL (not as bind parameters).
const RESERVATION_COLUMNS = Prisma.raw(`
  r."id", r."reference", r."status", r."starts_at" AS "startsAt", r."ends_at" AS "endsAt",
  r."party_size" AS "partySize", r."guest_name" AS "guestName", r."guest_phone" AS "guestPhone",
  r."guest_email" AS "guestEmail", r."guest_id" AS "guestId", r."notes", r."source",
  r."seated_at" AS "seatedAt", r."completed_at" AS "completedAt", r."cancelled_at" AS "cancelledAt",
  r."created_at" AS "createdAt", r.deposit_terms AS "depositTerms", r.payment_hold_expires_at AS "paymentHoldExpiresAt",
  (SELECT json_build_object('state',o.state,'url',o.checkout_url) FROM venue_deposit_operations o WHERE o.tenant_id=r.tenant_id AND o.venue_id=r.venue_id AND o.reservation_id=r.id AND o.kind='checkout') AS checkout,
  (SELECT o.state FROM venue_deposit_operations o WHERE o.tenant_id=r.tenant_id AND o.venue_id=r.venue_id AND o.reservation_id=r.id AND o.kind='refund') AS "refundState",
  COALESCE((SELECT sum(CASE WHEN p.kind='CHARGE' THEN p.amount ELSE -p.amount END)::text FROM venue_deposit_receipts p WHERE p.tenant_id=r.tenant_id AND p.venue_id=r.venue_id AND p.reservation_id=r.id),'0.00') AS "paidDeposit",
  EXISTS(SELECT 1 FROM venue_deposit_receipts p WHERE p.tenant_id=r.tenant_id AND p.venue_id=r.venue_id AND p.reservation_id=r.id AND p.requires_refund AND NOT EXISTS(SELECT 1 FROM venue_deposit_receipts x WHERE x.tenant_id=p.tenant_id AND x.venue_id=p.venue_id AND x.reservation_id=p.reservation_id AND x.kind='REFUND')) AS "requiresRefundReview",
  COALESCE((
    SELECT json_agg(json_build_object('id', t."id", 'label', t."label", 'areaId', a."id", 'areaName', a."name") ORDER BY t."label")
    FROM "venue_reservation_tables" rt
    JOIN "venue_tables" t ON t."tenant_id" = rt."tenant_id" AND t."venue_id" = rt."venue_id" AND t."id" = rt."table_id"
    JOIN "venue_areas" a ON a."tenant_id" = t."tenant_id" AND a."venue_id" = t."venue_id" AND a."id" = t."area_id"
    WHERE rt."tenant_id" = r."tenant_id" AND rt."reservation_id" = r."id"
  ), '[]'::json) AS "tables",
  (
    SELECT json_build_object('bookingId', b."id", 'startsOn', b."starts_on"::text, 'endsOn', b."ends_on"::text, 'room', rm."name")
    FROM "bookings" b
    LEFT JOIN "rooms" rm ON rm."id" = b."room_id"
    WHERE r."guest_id" IS NOT NULL AND b."tenant_id" = r."tenant_id" AND b."guest_id" = r."guest_id"
      AND b."property_id" = v."property_id" AND b."status"::text = 'CONFIRMED'
      AND b."starts_on" <= (r."starts_at" AT TIME ZONE v."timezone")::date
      AND (r."starts_at" AT TIME ZONE v."timezone")::date <= b."ends_on"
    ORDER BY b."starts_on" DESC LIMIT 1
  ) AS "stay"
`);

const TRANSITIONS: Record<string, SettableStatus[]> = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed', 'confirmed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2010' &&
    (error as { meta?: { code?: string } }).meta?.code === '23505'
  );
}

@Injectable()
export class VenueReservationsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(VenueDepositRulesService) private readonly depositRules: VenueDepositRulesService,
    @Inject(VenueDepositPaymentsService)
    private readonly depositPayments: VenueDepositPaymentsService,
  ) {}

  /** Bookable times for a day and party size, with the tables free at each time. */
  async availability(tenantId: string, venueId: string, query: Record<string, unknown>) {
    const input = parseAvailabilityQuery(query);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const venue = await this.venue(tx, tenantId, venueId);
      const tz = venue.timezone!;
      const base = {
        date: input.date,
        partySize: input.partySize,
        diningMinutes: input.durationMinutes ?? venue.diningMinutes,
      };

      const services = await tx.$queryRaw<
        Array<{ name: string; opensAt: string; closesAt: string; slotMinutes: number }>
      >`
        SELECT "name", to_char("opens_at", 'HH24:MI') AS "opensAt", to_char("closes_at", 'HH24:MI') AS "closesAt",
               "slot_minutes" AS "slotMinutes"
        FROM "venue_services"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
          AND ${isoWeekday(input.date)}::smallint = ANY("days")
        ORDER BY "opens_at"
      `;
      if (services.length === 0) return { ...base, reason: 'CLOSED' as const, services: [] };

      const clock = await tx.$queryRaw<Array<{ now: Date; today: string }>>`
        SELECT now() AS "now", (now() AT TIME ZONE ${tz})::date::text AS "today"
      `;
      const now = clock[0]!.now;
      if (input.channel === 'online') {
        if (input.partySize > venue.maxOnlinePartySize)
          return { ...base, reason: 'PARTY_TOO_LARGE' as const, services: [] };
        const ahead =
          (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${clock[0]!.today}T00:00:00Z`)) /
          86_400_000;
        if (ahead > venue.advanceBookingDays)
          return { ...base, reason: 'TOO_FAR_AHEAD' as const, services: [] };
      }

      const tables = await this.fittingTables(
        tx,
        tenantId,
        venueId,
        input.partySize,
        input.areaId,
        input.channel === 'online',
      );
      const plan = services.map((service) => ({
        service,
        times: [
          ...new Set([
            ...slotTimes(
              service.opensAt,
              service.closesAt,
              service.slotMinutes,
              venue.lastBookingMinutesBeforeClose,
            ).filter((time) => time < service.closesAt),
            ...(input.time &&
            input.channel === 'staff' &&
            input.time >= service.opensAt &&
            input.time < service.closesAt
              ? [input.time]
              : []),
          ]),
        ].sort(),
      }));
      const allTimes = [...new Set(plan.flatMap((p) => p.times))];
      const starts = allTimes.length
        ? await tx.$queryRaw<Array<{ time: string; startsAt: Date }>>`
            SELECT t AS "time", ((${input.date}::date + t::time) AT TIME ZONE ${tz}) AS "startsAt"
            FROM unnest(${allTimes}::text[]) AS t
          `
        : [];
      const startOf = new Map(starts.map((row) => [row.time, row.startsAt]));
      const first = starts.length
        ? new Date(Math.min(...starts.map((s) => s.startsAt.getTime())))
        : now;
      const busy = await this.busy(tx, tenantId, venueId, first, base.diningMinutes + 24 * 60);
      const grace = input.channel === 'online' ? 0 : 30 * 60_000;

      return {
        ...base,
        reason: null,
        services: plan.map(({ service, times }) => ({
          name: service.name,
          opensAt: service.opensAt,
          closesAt: service.closesAt,
          slots: times.map((time) => {
            const startsAt = startOf.get(time)!;
            const endsAt = new Date(startsAt.getTime() + base.diningMinutes * 60_000);
            const free = tables.filter(
              (table) =>
                !busy.some(
                  (b) => b.tableId === table.id && b.startsAt < endsAt && b.endsAt > startsAt,
                ),
            );
            const past = startsAt.getTime() < now.getTime() - grace;
            return {
              time,
              startsAt,
              bookable: !past && free.length > 0,
              past,
              freeTables: free,
              freeAreas: [...new Set(free.map((table) => table.areaId))].map((id) => ({
                id,
                name: free.find((table) => table.areaId === id)!.areaName,
                tables: free.filter((table) => table.areaId === id),
              })),
              bestTableId: pickBestTable(free, input.partySize)?.id ?? null,
            };
          }),
        })),
      };
    });
  }

  /** A staff booking: phone call, walk-in, anything entered by hand. */
  async create(
    tenantId: string,
    venueId: string,
    actorUserId: string | null,
    body: unknown,
    online = false,
  ) {
    const input = parseReservationCreate(body);
    const raw = body as Record<string, unknown>;
    const requestKey = raw.requestKey;
    if (
      requestKey !== undefined &&
      (typeof requestKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey))
    )
      throw new BadRequestException('Invalid booking request key.');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...input,
          ...(online ? { channel: 'online' } : {}),
          depositAmount: raw.depositAmount ?? null,
          depositQuoteHash: raw.depositQuoteHash ?? null,
          depositOverrideReason: raw.depositOverrideReason ?? null,
        }),
      )
      .digest('hex');
    for (let attempt = 0; ; attempt += 1)
      try {
        const created = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
          requireDining(await loadVenuePlan(tx, tenantId));
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${venueId}, 0))`;
          if (requestKey) {
            const existing = await tx.$queryRaw<
              Array<{ id: string; hash: string }>
            >`SELECT id,request_hash AS hash FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND request_key=${requestKey}::uuid`;
            if (existing[0]) {
              if (existing[0].hash !== requestHash)
                throw new ConflictException(
                  'This booking request key was already used for different details.',
                );
              return this.view(tx, tenantId, venueId, existing[0].id);
            }
          }
          // Policy/hour edits also lock the venue row; hold a consistent configuration until commit.
          await tx.$queryRaw`SELECT id FROM venues WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid FOR SHARE`;
          const venue = await this.venue(tx, tenantId, venueId);
          const minutes = input.durationMinutes ?? venue.diningMinutes;
          const window = await this.window(tx, venue, input.date, input.time, minutes);
          await this.requireOpen(tx, tenantId, venueId, input.date, input.time);
          await this.requireNotPast(tx, window.startsAt);
          if (online) {
            const account = await tx.$queryRaw<
              Array<{ readOnly: boolean; state: LifecycleState }>
            >`SELECT p.read_only AS "readOnly",o.lifecycle_state::text AS state FROM organizations o JOIN plans p ON p.id=o.plan_id WHERE o.id=${tenantId}::uuid FOR SHARE OF o,p`;
            if (!account[0] || account[0].readOnly || !publicBookingAllowed(account[0].state))
              throw new ConflictException('This restaurant is not taking online bookings.');
            const clock = await tx.$queryRaw<
              Array<{ now: Date; today: string }>
            >`SELECT now() AS now,(now() AT TIME ZONE ${venue.timezone})::date::text AS today`;
            const ahead = (Date.parse(input.date) - Date.parse(clock[0]!.today)) / 86400000;
            const services = await tx.$queryRaw<
              Array<{ opensAt: string; closesAt: string; slotMinutes: number }>
            >`SELECT to_char(opens_at,'HH24:MI') AS "opensAt",to_char(closes_at,'HH24:MI') AS "closesAt",slot_minutes AS "slotMinutes" FROM venue_services WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND ${isoWeekday(input.date)}::smallint=ANY(days)`;
            if (
              input.partySize > venue.maxOnlinePartySize ||
              ahead > venue.advanceBookingDays ||
              window.startsAt < clock[0]!.now ||
              !services.some((s) =>
                slotTimes(
                  s.opensAt,
                  s.closesAt,
                  s.slotMinutes,
                  venue.lastBookingMinutesBeforeClose,
                ).includes(input.time),
              )
            )
              throw new ConflictException(
                'This time or party is not available for online booking.',
              );
          }

          const table = await this.chooseTable(tx, {
            tenantId,
            venueId,
            partySize: input.partySize,
            tableId: input.tableId,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            ignoreReservationId: null,
            online,
          });
          const terms = await this.depositRules.quoteInTransaction(
            tx,
            tenantId,
            venueId,
            actorUserId,
            { ...raw, ...input, tableId: table.id },
          );
          const needsDeposit = depositMinor(terms.amount) > 0n;
          if ((needsDeposit || raw.depositQuoteHash) && raw.depositQuoteHash !== terms.quoteHash)
            throw new ConflictException(
              'Deposit terms changed. Review the current quote before booking.',
            );
          if (needsDeposit && !requestKey)
            throw new BadRequestException('A booking request key is required for a deposit.');
          if (needsDeposit) await this.depositPayments.requireStaging(tenantId, venue.propertyId);
          const status = needsDeposit ? 'pending_payment' : 'confirmed';
          const guestId = input.guestEmail
            ? await this.linkGuest(
                tx,
                tenantId,
                input.guestName,
                input.guestEmail,
                input.guestPhone,
              )
            : null;
          const id = crypto.randomUUID();
          await tx.$executeRaw`
            INSERT INTO "venue_reservations"
              ("id", "tenant_id", "venue_id", "reference", "status", "starts_at", "ends_at", "party_size",
               "guest_name", "guest_phone", "guest_email", "guest_id", "notes", "source", "created_by_user_id",request_key,request_hash,deposit_terms,payment_hold_expires_at)
            VALUES (${id}::uuid, ${tenantId}::uuid, ${venueId}::uuid, ${newReservationReference()}, ${status},
                    ${window.startsAt}, ${window.endsAt}, ${input.partySize}, ${input.guestName},
                    ${input.guestPhone}, ${input.guestEmail}, ${guestId}::uuid, ${input.notes}, ${online ? 'website' : input.source},
                    ${actorUserId}::uuid,${requestKey ?? null}::uuid,${requestHash},${JSON.stringify(terms)}::jsonb,CASE WHEN ${needsDeposit} THEN now()+(${venue.holdMinutes}::integer*interval '1 minute') ELSE NULL END)
          `;
          await tx.$executeRaw`
            INSERT INTO "venue_reservation_tables" ("tenant_id", "venue_id", "reservation_id", "table_id")
            VALUES (${tenantId}::uuid, ${venueId}::uuid, ${id}::uuid, ${table.id}::uuid)
          `;
          await this.event(tx, tenantId, venueId, id, null, status, actorUserId, null);
          return this.view(tx, tenantId, venueId, id);
        });
        await this.depositPayments.start(tenantId, venueId, created.id);
        return this.get(tenantId, venueId, created.id);
      } catch (error) {
        // A reference is random; on the rare clash try again with a new one.
        if (uniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
  }

  async list(tenantId: string, venueId: string, query: Record<string, unknown>) {
    const input = parseListQuery(query);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const venue = await this.venue(tx, tenantId, venueId);
      const tz = venue.timezone!;
      const like = input.q ? `%${input.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const filters = Prisma.sql`r."tenant_id" = ${tenantId}::uuid AND r."venue_id" = ${venueId}::uuid
          AND r."starts_at" >= (${input.from}::date AT TIME ZONE ${tz})
          AND r."starts_at" < ((${input.to}::date + 1) AT TIME ZONE ${tz})
          AND (${input.statuses}::text[] IS NULL OR r."status" = ANY(${input.statuses}::text[]))
          AND (${like}::text IS NULL OR r."guest_name" ILIKE ${like} OR r."reference" ILIKE ${like} OR r."guest_phone" ILIKE ${like} OR r."guest_email" ILIKE ${like})`;
      const orderColumn = {
        startsAt: 'r."starts_at"',
        guestName: 'r."guest_name"',
        partySize: 'r."party_size"',
        status: 'r."status"',
        table: `(SELECT string_agg(t.label, ',' ORDER BY t.label) FROM venue_reservation_tables rt JOIN venue_tables t ON t.tenant_id=rt.tenant_id AND t.venue_id=rt.venue_id AND t.id=rt.table_id WHERE rt.tenant_id=r.tenant_id AND rt.venue_id=r.venue_id AND rt.reservation_id=r.id)`,
      }[input.sort ?? 'startsAt'];
      const rows = await tx.$queryRaw<ReservationView[]>`
        SELECT ${RESERVATION_COLUMNS} FROM "venue_reservations" r
        JOIN "venues" v ON v."tenant_id" = r."tenant_id" AND v."id" = r."venue_id"
        WHERE ${filters} ORDER BY ${Prisma.raw(orderColumn)} ${Prisma.raw(input.order === 'desc' ? 'DESC' : 'ASC')}, r."id"
        LIMIT ${input.limit} OFFSET ${input.offset ?? 0}`;
      const count = await tx.$queryRaw<
        Array<{ total: number }>
      >`SELECT count(*)::integer AS total FROM venue_reservations r WHERE ${filters}`;
      return { timezone: tz, reservations: rows, total: count[0]!.total };
    });
  }

  async searchGuests(tenantId: string, venueId: string, search: unknown) {
    const term = typeof search === 'string' ? search.trim() : '';
    const like = `%${term.slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`;
    const digits = term.replace(/\D/g, '').slice(0, 30);
    const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      await this.venue(tx, tenantId, venueId);
      if (term.length < 2) return [];
      return tx.$queryRaw`SELECT g.id,g.email,g.first_name AS "firstName",g.last_name AS "lastName",g.phone,
        (SELECT count(*)::integer FROM venue_reservations r WHERE r.tenant_id=g.tenant_id AND r.venue_id=${venueId}::uuid AND r.guest_id=g.id) AS "bookingCount"
        FROM guests g WHERE g.tenant_id=${tenantId}::uuid AND g.merged_into_guest_id IS NULL
        AND (EXISTS(SELECT 1 FROM venue_reservations r WHERE r.tenant_id=g.tenant_id AND r.venue_id=${venueId}::uuid AND r.guest_id=g.id)
          OR EXISTS(SELECT 1 FROM bookings b JOIN venues v ON v.tenant_id=b.tenant_id AND v.property_id=b.property_id WHERE b.tenant_id=g.tenant_id AND b.guest_id=g.id AND v.id=${venueId}::uuid))
        AND (concat_ws(' ',g.first_name,g.last_name) ILIKE ${like} OR g.email ILIKE ${like} OR g.phone ILIKE ${like}
          OR (${phoneLike}::text IS NOT NULL AND regexp_replace(g.phone,'[^0-9]','','g') LIKE ${phoneLike}))
        ORDER BY g.last_name,g.first_name,g.id LIMIT 8`;
    });
  }

  async get(tenantId: string, venueId: string, reservationId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const reservation = await this.view(tx, tenantId, venueId, reservationId);
      const events = await tx.$queryRaw<
        Array<{
          fromStatus: string | null;
          toStatus: string;
          occurredAt: Date;
          note: string | null;
          by: string | null;
        }>
      >`
        SELECT e."from_status" AS "fromStatus", e."to_status" AS "toStatus", e."occurred_at" AS "occurredAt",
               e."note", u."email" AS "by"
        FROM "venue_reservation_events" e
        LEFT JOIN "users" u ON u."id" = e."actor_user_id"
        WHERE e."tenant_id" = ${tenantId}::uuid AND e."venue_id" = ${venueId}::uuid AND e."reservation_id" = ${reservationId}::uuid
        ORDER BY e."occurred_at", e."id"
      `;
      return { ...reservation, events };
    });
  }

  async setStatus(
    tenantId: string,
    venueId: string,
    reservationId: string,
    actorUserId: string,
    body: unknown,
  ) {
    const change = parseStatusChange(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${venueId}, 0))`;
      const current = await tx.$queryRaw<Array<{ status: string; startsAt: Date }>>`
        SELECT "status", "starts_at" AS "startsAt" FROM "venue_reservations"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${reservationId}::uuid
        FOR UPDATE
      `;
      if (!current[0]) throw new NotFoundException('Reservation was not found.');
      const from = current[0].status;
      if (from === change.status) return this.view(tx, tenantId, venueId, reservationId);
      if (from === 'pending_payment' && change.status === 'confirmed') {
        const owed = await tx.$queryRaw<
          Array<{ owed: boolean }>
        >`SELECT (deposit_terms->>'amount')::numeric>0 AS owed FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${reservationId}::uuid`;
        if (owed[0]?.owed)
          throw new ConflictException('A deposit booking is confirmed only by a verified payment.');
      }
      if (!(TRANSITIONS[from] ?? []).includes(change.status))
        throw new ConflictException({
          message: `A ${from.replace('_', ' ')} reservation cannot become ${change.status.replace('_', ' ')}.`,
          code: 'INVALID_STATUS_CHANGE',
        });
      if (change.status === 'no_show' && current[0].startsAt.getTime() > Date.now())
        throw new ConflictException({
          message: 'A booking cannot be a no-show before its time.',
          code: 'INVALID_STATUS_CHANGE',
        });
      const to = change.status;
      await tx.$executeRaw`
        UPDATE "venue_reservations" SET
          "status" = ${to},
          "seated_at" = CASE WHEN ${to} = 'seated' THEN now() WHEN ${to} = 'confirmed' THEN NULL ELSE "seated_at" END,
          "completed_at" = CASE WHEN ${to} = 'completed' THEN now() ELSE "completed_at" END,
          "cancelled_at" = CASE WHEN ${to} = 'cancelled' THEN now() ELSE "cancelled_at" END,
          -- Finishing early frees the table for the next booking.
          "ends_at" = CASE WHEN ${to} = 'completed' AND now() > "starts_at" AND now() < "ends_at" THEN now() ELSE "ends_at" END,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${reservationId}::uuid
      `;
      await this.event(tx, tenantId, venueId, reservationId, from, to, actorUserId, change.note);
      return this.view(tx, tenantId, venueId, reservationId);
    });
  }

  /** Change the time, party, table or details of a booking that has not finished. */
  async update(
    tenantId: string,
    venueId: string,
    reservationId: string,
    actorUserId: string,
    body: unknown,
  ) {
    const input = parseReservationUpdate(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${venueId}, 0))`;
      const venue = await this.venue(tx, tenantId, venueId);
      const rows = await tx.$queryRaw<
        Array<{
          status: string;
          partySize: number;
          startsAt: Date;
          endsAt: Date;
          localDate: string;
          localTime: string;
          tableId: string | null;
        }>
      >`
        SELECT r."status", r."party_size" AS "partySize", r."starts_at" AS "startsAt", r."ends_at" AS "endsAt",
               (r."starts_at" AT TIME ZONE ${venue.timezone})::date::text AS "localDate",
               to_char(r."starts_at" AT TIME ZONE ${venue.timezone}, 'HH24:MI') AS "localTime",
               (SELECT rt."table_id" FROM "venue_reservation_tables" rt
                 WHERE rt."tenant_id" = r."tenant_id" AND rt."reservation_id" = r."id" LIMIT 1) AS "tableId"
        FROM "venue_reservations" r
        WHERE r."tenant_id" = ${tenantId}::uuid AND r."venue_id" = ${venueId}::uuid AND r."id" = ${reservationId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException('Reservation was not found.');
      if (['completed', 'cancelled', 'no_show'].includes(current.status))
        throw new ConflictException({
          message: 'A finished reservation cannot be changed.',
          code: 'RESERVATION_CLOSED',
        });
      const moves = this.movesBooking(input);
      if (moves) {
        const saved = await tx.$queryRaw<
          Array<{ amount: string }>
        >`SELECT deposit_terms->>'amount' AS amount FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${reservationId}::uuid`;
        if (saved[0]?.amount && depositMinor(saved[0].amount) > 0n)
          throw new ConflictException(
            'Cancel and rebook to change the time, party or table of a deposit booking. Accepted terms cannot change.',
          );
      }
      if (moves && current.status === 'seated')
        throw new ConflictException({
          message: 'Guests who are seated cannot be moved to another time.',
          code: 'RESERVATION_CLOSED',
        });

      const date = input.date ?? current.localDate;
      const time = input.time ?? current.localTime;
      const partySize = input.partySize ?? current.partySize;
      let startsAt = current.startsAt;
      let endsAt = current.endsAt;
      if (moves) {
        const minutes =
          input.durationMinutes ??
          Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000);
        ({ startsAt, endsAt } = await this.window(tx, venue, date, time, minutes));
        if (input.date !== undefined || input.time !== undefined) {
          await this.requireOpen(tx, tenantId, venueId, date, time);
          await this.requireNotPast(tx, startsAt);
        }
        const table = await this.chooseTable(tx, {
          tenantId,
          venueId,
          partySize,
          tableId: input.tableId ?? current.tableId,
          startsAt,
          endsAt,
          ignoreReservationId: reservationId,
          // Keep the table if it still works; otherwise find another one.
          fallbackToBest: input.tableId === undefined || input.tableId === null,
        });
        const changedTerms = await this.depositRules.quoteInTransaction(
          tx,
          tenantId,
          venueId,
          actorUserId,
          { date, time, partySize, tableId: table.id, durationMinutes: minutes },
        );
        if (depositMinor(changedTerms.amount) > 0n)
          throw new ConflictException(
            'This change requires a deposit. Cancel and rebook to review the new terms.',
          );
        await tx.$executeRaw`
          DELETE FROM "venue_reservation_tables"
          WHERE "tenant_id" = ${tenantId}::uuid AND "reservation_id" = ${reservationId}::uuid
        `;
        await tx.$executeRaw`
          INSERT INTO "venue_reservation_tables" ("tenant_id", "venue_id", "reservation_id", "table_id")
          VALUES (${tenantId}::uuid, ${venueId}::uuid, ${reservationId}::uuid, ${table.id}::uuid)
        `;
      }
      const guestId =
        input.guestEmail !== undefined
          ? input.guestEmail
            ? await this.linkGuest(
                tx,
                tenantId,
                input.guestName ?? 'Guest',
                input.guestEmail,
                input.guestPhone ?? null,
              )
            : null
          : undefined;
      await tx.$executeRaw`
        UPDATE "venue_reservations" SET
          "starts_at" = ${startsAt}, "ends_at" = ${endsAt}, "party_size" = ${partySize},
          "guest_name" = CASE WHEN ${'guestName' in input}::boolean THEN ${input.guestName ?? null} ELSE "guest_name" END,
          "guest_phone" = CASE WHEN ${'guestPhone' in input}::boolean THEN ${input.guestPhone ?? null} ELSE "guest_phone" END,
          "guest_email" = CASE WHEN ${'guestEmail' in input}::boolean THEN ${input.guestEmail ?? null} ELSE "guest_email" END,
          "guest_id" = CASE WHEN ${guestId !== undefined}::boolean THEN ${guestId ?? null}::uuid ELSE "guest_id" END,
          "notes" = CASE WHEN ${'notes' in input}::boolean THEN ${input.notes ?? null} ELSE "notes" END,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${reservationId}::uuid
      `;
      await this.event(
        tx,
        tenantId,
        venueId,
        reservationId,
        current.status,
        current.status,
        actorUserId,
        'Details changed',
      );
      return this.view(tx, tenantId, venueId, reservationId);
    });
  }

  /** Every table with its state at a moment (now by default), for the live floor plan. */
  async floor(tenantId: string, venueId: string, query: Record<string, unknown>) {
    const { at: requested, to } = parseFloorQuery(query);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const venue = await this.venue(tx, tenantId, venueId);
      const areas = await tx.$queryRaw<
        Array<{ id: string; name: string; mapWidth: number; mapHeight: number }>
      >`
        SELECT "id", "name", "map_width" AS "mapWidth", "map_height" AS "mapHeight" FROM "venue_areas"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "active"
        ORDER BY "sort_order", "created_at", "name"
      `;
      const tables = await tx.$queryRaw<
        Array<{
          id: string;
          areaId: string;
          label: string;
          minSeats: number;
          maxSeats: number;
          mapX: number;
          mapY: number;
          mapWidth: number;
          mapHeight: number;
          shape: string;
          active: boolean;
        }>
      >`
        SELECT "id", "area_id" AS "areaId", "label", "min_seats" AS "minSeats", "max_seats" AS "maxSeats",
               "map_x" AS "mapX", "map_y" AS "mapY", "map_width" AS "mapWidth", "map_height" AS "mapHeight",
               "shape", "active"
        FROM "venue_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
        ORDER BY "label"
      `;
      const live = await tx.$queryRaw<
        Array<{
          tableId: string;
          id: string;
          reference: string;
          status: BookingStatus;
          startsAt: Date;
          endsAt: Date;
          guestName: string;
          partySize: number;
        }>
      >`
        SELECT rt."table_id" AS "tableId", r."id", r."reference", r."status", r."starts_at" AS "startsAt",
               r."ends_at" AS "endsAt", r."guest_name" AS "guestName", r."party_size" AS "partySize"
        FROM "venue_reservations" r
        JOIN "venue_reservation_tables" rt ON rt."tenant_id" = r."tenant_id" AND rt."reservation_id" = r."id"
        WHERE r."tenant_id" = ${tenantId}::uuid AND r."venue_id" = ${venueId}::uuid
          AND r."status" IN ('pending_payment', 'confirmed', 'seated')
        AND (r.status<>'pending_payment' OR r.payment_hold_expires_at IS NULL OR r.payment_hold_expires_at>now())
          AND r."starts_at" < ${to ?? new Date(requested.getTime() + 24 * 3_600_000)}
          AND (r."ends_at" > ${to ? requested : new Date(requested.getTime() - 24 * 3_600_000)} OR r."status" = 'seated')
        ORDER BY r."starts_at", r."id"
      `;
      const summary = (b?: (typeof live)[number]) =>
        b && {
          id: b.id,
          reference: b.reference,
          status: b.status,
          guestName: b.guestName,
          partySize: b.partySize,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
        };
      return {
        at: requested,
        ...(to ? { from: requested, to } : {}),
        timezone: venue.timezone,
        areas: areas.map((area) => ({
          ...area,
          tables: tables
            .filter((table) => table.areaId === area.id)
            .map((table) => {
              const result = tableStatusAt(
                table.active,
                live.filter((b) => b.tableId === table.id),
                requested,
              );
              return {
                ...table,
                status: result.status as TableStatus,
                bookings: to
                  ? live
                      .filter(
                        (b) => b.tableId === table.id && b.startsAt < to && b.endsAt > requested,
                      )
                      .map((b) => summary(b)!)
                  : [],
                current: summary(result.current as (typeof live)[number] | undefined) ?? null,
                next: summary(result.next as (typeof live)[number] | undefined) ?? null,
              };
            }),
        })),
      };
    });
  }

  // ---- helpers -------------------------------------------------------------------------------

  private movesBooking(input: ReservationUpdate): boolean {
    return (
      input.date !== undefined ||
      input.time !== undefined ||
      input.partySize !== undefined ||
      input.tableId !== undefined ||
      input.durationMinutes !== undefined
    );
  }

  private async venue(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
  ): Promise<VenueSettings> {
    const rows = await tx.$queryRaw<VenueSettings[]>`
      SELECT "id", property_id AS "propertyId",hold_minutes AS "holdMinutes", "active", "timezone", "setup_completed_at" AS "setupCompletedAt",
             "dining_minutes" AS "diningMinutes", "advance_booking_days" AS "advanceBookingDays",
             "max_online_party_size" AS "maxOnlinePartySize",
             "last_booking_minutes_before_close" AS "lastBookingMinutesBeforeClose"
      FROM "venues" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
    `;
    const venue = rows[0];
    if (!venue) throw new NotFoundException('Restaurant was not found.');
    if (!venue.active || !venue.timezone || !venue.setupCompletedAt)
      throw new ConflictException({
        message: 'Finish the restaurant setup before taking bookings.',
        code: 'SETUP_NOT_COMPLETE',
      });
    return venue;
  }

  private async window(
    tx: TenantTransaction,
    venue: VenueSettings,
    date: string,
    time: string,
    minutes: number,
  ) {
    const rows = await tx.$queryRaw<Array<{ startsAt: Date; endsAt: Date }>>`
      SELECT s AS "startsAt", s + (${minutes}::integer * interval '1 minute') AS "endsAt"
      FROM (SELECT ((${date}::date + ${time}::time) AT TIME ZONE ${venue.timezone}) AS s) x
    `;
    return rows[0]!;
  }

  private async requireOpen(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    date: string,
    time: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ open: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM "venue_services"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
          AND ${isoWeekday(date)}::smallint = ANY("days")
          AND ${time}::time >= "opens_at" AND ${time}::time < "closes_at"
      ) AS "open"
    `;
    if (!rows[0]?.open)
      throw new BadRequestException({
        message: 'The restaurant is closed at that time.',
        code: 'OUTSIDE_OPENING_HOURS',
      });
  }

  private async requireNotPast(tx: TenantTransaction, startsAt: Date) {
    const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT (${startsAt}::timestamptz >= now() - interval '30 minutes') AS "ok"
    `;
    if (!rows[0]?.ok)
      throw new BadRequestException({
        message: 'That time has already passed.',
        code: 'IN_THE_PAST',
      });
  }

  private async fittingTables(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    partySize: number,
    areaId: string | null,
    onlineOnly = false,
  ): Promise<TableRow[]> {
    return tx.$queryRaw<TableRow[]>`
      SELECT t."id", t."label", t."min_seats" AS "minSeats", t."max_seats" AS "maxSeats",
             a."id" AS "areaId", a."name" AS "areaName", t."priority"
      FROM "venue_tables" t
      JOIN "venue_areas" a ON a."tenant_id" = t."tenant_id" AND a."venue_id" = t."venue_id" AND a."id" = t."area_id"
      WHERE t."tenant_id" = ${tenantId}::uuid AND t."venue_id" = ${venueId}::uuid
        AND t."active" AND a."active"
        AND (NOT ${onlineOnly}::boolean OR t."online_bookable")
        AND t."min_seats" <= ${partySize} AND ${partySize} <= t."max_seats"
        AND (${areaId}::uuid IS NULL OR a."id" = ${areaId}::uuid)
      ORDER BY t."label"
    `;
  }

  private async busy(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    from: Date,
    afterMinutes: number,
  ) {
    return tx.$queryRaw<Array<{ tableId: string; startsAt: Date; endsAt: Date }>>`
      SELECT rt."table_id" AS "tableId", r."starts_at" AS "startsAt", r."ends_at" AS "endsAt"
      FROM "venue_reservations" r
      JOIN "venue_reservation_tables" rt ON rt."tenant_id" = r."tenant_id" AND rt."reservation_id" = r."id"
      WHERE r."tenant_id" = ${tenantId}::uuid AND r."venue_id" = ${venueId}::uuid
        AND r."status" IN ('pending_payment', 'confirmed', 'seated')
        AND (r.status<>'pending_payment' OR r.payment_hold_expires_at IS NULL OR r.payment_hold_expires_at>now())
        AND r."ends_at" > ${from}
        AND r."starts_at" < ${new Date(from.getTime() + afterMinutes * 60_000)}
    `;
  }

  /** The table for a booking: the one asked for (it must fit and be free) or the best free fit. */
  private async chooseTable(
    tx: TenantTransaction,
    p: {
      tenantId: string;
      venueId: string;
      partySize: number;
      tableId: string | null;
      startsAt: Date;
      endsAt: Date;
      ignoreReservationId: string | null;
      fallbackToBest?: boolean;
      online?: boolean;
    },
  ): Promise<TableRow> {
    const fitting = await this.fittingTables(
      tx,
      p.tenantId,
      p.venueId,
      p.partySize,
      null,
      p.online ?? false,
    );
    const taken = await tx.$queryRaw<Array<{ tableId: string }>>`
      SELECT rt."table_id" AS "tableId"
      FROM "venue_reservations" r
      JOIN "venue_reservation_tables" rt ON rt."tenant_id" = r."tenant_id" AND rt."reservation_id" = r."id"
      WHERE r."tenant_id" = ${p.tenantId}::uuid AND r."venue_id" = ${p.venueId}::uuid
        AND r."status" IN ('pending_payment', 'confirmed', 'seated')
        AND (r.status<>'pending_payment' OR r.payment_hold_expires_at IS NULL OR r.payment_hold_expires_at>now())
        AND r."starts_at" < ${p.endsAt} AND r."ends_at" > ${p.startsAt}
        AND (${p.ignoreReservationId}::uuid IS NULL OR r."id" <> ${p.ignoreReservationId}::uuid)
    `;
    const takenIds = new Set(taken.map((row) => row.tableId));
    const free = fitting.filter((table) => !takenIds.has(table.id));
    if (p.tableId) {
      const wanted = free.find((table) => table.id === p.tableId);
      if (wanted) return wanted;
      if (!p.fallbackToBest)
        throw new ConflictException({
          message: 'That table is not free at that time, or does not fit the party.',
          code: 'TABLE_NOT_AVAILABLE',
        });
    }
    const best = pickBestTable(free, p.partySize);
    if (!best)
      throw new ConflictException({
        message: 'There is no free table for that party at that time.',
        code: 'NO_TABLE_AVAILABLE',
      });
    return best;
  }

  /** Finds the hotel's guest by email, or adds one, so the booking is on their profile. */
  private async linkGuest(
    tx: TenantTransaction,
    tenantId: string,
    fullName: string,
    email: string,
    phone: string | null,
  ): Promise<string> {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "guests"
      WHERE "tenant_id" = ${tenantId}::uuid AND lower("email") = ${email}
        AND "merged_into_guest_id" IS NULL
      LIMIT 1
    `;
    if (existing[0]) return existing[0].id;
    const [first, ...rest] = fullName.trim().split(/\s+/);
    const id = crypto.randomUUID();
    await tx.$executeRaw`
      INSERT INTO "guests" ("id", "tenant_id", "email", "first_name", "last_name", "phone")
      VALUES (${id}::uuid, ${tenantId}::uuid, ${email}, ${first ?? null}, ${rest.join(' ') || null}, ${phone})
      ON CONFLICT DO NOTHING
    `;
    const found = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "guests" WHERE "tenant_id" = ${tenantId}::uuid AND lower("email") = ${email}
      ORDER BY "created_at" LIMIT 1
    `;
    return found[0]!.id;
  }

  private event(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    reservationId: string,
    from: string | null,
    to: string,
    actorUserId: string | null,
    note: string | null,
  ) {
    return tx.$executeRaw`
      INSERT INTO "venue_reservation_events" ("tenant_id", "venue_id", "reservation_id", "from_status", "to_status", "actor_user_id", "note")
      VALUES (${tenantId}::uuid, ${venueId}::uuid, ${reservationId}::uuid, ${from}, ${to}, ${actorUserId}::uuid, ${note})
    `;
  }

  private async view(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    id: string,
  ): Promise<ReservationView> {
    const rows = await tx.$queryRaw<ReservationView[]>`
      SELECT ${RESERVATION_COLUMNS}
      FROM "venue_reservations" r
      JOIN "venues" v ON v."tenant_id" = r."tenant_id" AND v."id" = r."venue_id"
      WHERE r."tenant_id" = ${tenantId}::uuid AND r."venue_id" = ${venueId}::uuid AND r."id" = ${id}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Reservation was not found.');
    return rows[0];
  }
}
