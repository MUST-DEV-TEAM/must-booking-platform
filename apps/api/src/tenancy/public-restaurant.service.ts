import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { publicBookingAllowed, type LifecycleState } from '../platform/console/hotel-lifecycle';
import { TenantDatabaseService } from './tenant-database.service';
import { VenueReservationsService } from './venue-reservations.service';
import { VenueDepositRulesService } from './venue-deposit-rules.service';
import { loadVenuePlan, requireDining } from './venue-plan';
import { parseReservationCreate } from './venue-reservation-input';

type Selection = {
  date: string;
  time: string;
  partySize: number;
  durationMinutes: number;
  tableId: string;
  depositQuoteHash: string;
  requestKey: string;
};
type Token = {
  tenantId: string;
  venueId: string;
  kind: 'quote' | 'reservation';
  expires: number;
  selection?: Selection;
  reservationId?: string;
};
const localSigningKey = randomBytes(32).toString('base64url');

@Injectable()
export class PublicRestaurantService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(VenueReservationsService) private readonly reservations: VenueReservationsService,
    @Inject(VenueDepositRulesService) private readonly deposits: VenueDepositRulesService,
  ) {}

  async info(tenantId: string, venueId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const rows = await tx.$queryRaw<
        Array<{
          name: string;
          timezone: string;
          currency: string;
          diningMinutes: number;
          maxPartySize: number;
          advanceBookingDays: number;
          phone: string | null;
          state: LifecycleState;
        }>
      >`
        SELECT v.name,v.timezone,v.currency,v.phone,v.dining_minutes AS "diningMinutes",v.max_online_party_size AS "maxPartySize",v.advance_booking_days AS "advanceBookingDays",o.lifecycle_state::text AS state
        FROM venues v JOIN organizations o ON o.id=v.tenant_id JOIN plans p ON p.id=o.plan_id WHERE v.tenant_id=${tenantId}::uuid AND v.id=${venueId}::uuid AND v.active AND v.setup_completed_at IS NOT NULL AND NOT p.read_only`;
      const row = rows[0];
      if (!row || !publicBookingAllowed(row.state))
        throw new NotFoundException('This restaurant is not taking online bookings.');
      return {
        name: row.name,
        timezone: row.timezone,
        currency: row.currency,
        phone: row.phone,
        diningMinutes: row.diningMinutes,
        maxPartySize: row.maxPartySize,
        advanceBookingDays: row.advanceBookingDays,
      };
    });
  }

  /** Areas and tables a guest may pick from: only what is active and open to online booking. */
  async layout(tenantId: string, venueId: string) {
    await this.info(tenantId, venueId);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const areas = await tx.$queryRaw<
        Array<{ id: string; name: string; mapWidth: number; mapHeight: number }>
      >`SELECT id,name,map_width AS "mapWidth",map_height AS "mapHeight" FROM venue_areas WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND active ORDER BY sort_order,created_at,name`;
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
        }>
      >`SELECT id,area_id AS "areaId",label,min_seats AS "minSeats",max_seats AS "maxSeats",map_x AS "mapX",map_y AS "mapY",map_width AS "mapWidth",map_height AS "mapHeight",shape::text AS shape FROM venue_tables WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND active AND online_bookable ORDER BY label`;
      return {
        areas: areas
          .map((area) => ({ ...area, tables: tables.filter((t) => t.areaId === area.id) }))
          .filter((area) => area.tables.length),
      };
    });
  }

  async availability(tenantId: string, venueId: string, query: Record<string, unknown>) {
    await this.info(tenantId, venueId);
    const result = await this.reservations.availability(tenantId, venueId, {
      date: query.date,
      partySize: query.partySize,
      durationMinutes: query.durationMinutes,
      areaId: typeof query.areaId === 'string' && query.areaId ? query.areaId : undefined,
      channel: 'online',
    });
    return {
      date: result.date,
      partySize: result.partySize,
      diningMinutes: result.diningMinutes,
      reason: result.reason,
      services: result.services.map((s) => ({
        name: s.name,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
        slots: s.slots
          .filter((slot) => slot.bookable)
          .map((slot) => ({ time: slot.time, freeTableIds: slot.freeTables.map((t) => t.id) })),
      })),
    };
  }

  async quote(tenantId: string, venueId: string, body: unknown) {
    const info = await this.info(tenantId, venueId);
    const raw = this.object(body);
    const input = parseReservationCreate({
      date: raw.date,
      time: raw.time,
      partySize: raw.partySize,
      durationMinutes: raw.durationMinutes ?? info.diningMinutes,
      guestName: 'Website guest',
    });
    const wantedTable = typeof raw.tableId === 'string' && raw.tableId ? raw.tableId : null;
    const wantedArea = typeof raw.areaId === 'string' && raw.areaId ? raw.areaId : null;
    const available = await this.reservations.availability(tenantId, venueId, {
      date: input.date,
      partySize: input.partySize,
      durationMinutes: input.durationMinutes,
      areaId: wantedArea ?? undefined,
      channel: 'online',
    });
    const slot = available.services
      .flatMap((s) => s.slots)
      .find((s) => s.time === input.time && s.bookable);
    const chosenTableId = wantedTable
      ? (slot?.freeTables.find((t) => t.id === wantedTable)?.id ?? null)
      : (slot?.bestTableId ?? null);
    if (!slot || !chosenTableId)
      throw new ConflictException(
        wantedTable
          ? 'That table is no longer available. Please choose another.'
          : 'This time is no longer available. Please choose another.',
      );
    const selection = {
      date: input.date,
      time: input.time,
      partySize: input.partySize,
      durationMinutes: input.durationMinutes!,
      tableId: chosenTableId,
    };
    const terms = await this.database.withTenantTransaction({ tenantId }, (tx) =>
      this.deposits.quoteInTransaction(tx, tenantId, venueId, null, selection),
    );
    return {
      ...selection,
      tableId: undefined,
      amount: terms.amount,
      currency: terms.currency,
      freeCancelHours: terms.freeCancelHours,
      serviceName: terms.serviceName,
      areaName: terms.areaName,
      quoteToken: this.sign({
        tenantId,
        venueId,
        kind: 'quote',
        expires: Date.now() + 10 * 60_000,
        selection: { ...selection, depositQuoteHash: terms.quoteHash, requestKey: randomUUID() },
      }),
    };
  }

  async create(tenantId: string, venueId: string, body: unknown) {
    await this.info(tenantId, venueId);
    const raw = this.object(body);
    const quote = this.verify(raw.quoteToken, tenantId, venueId, 'quote', true);
    if (!quote.selection)
      throw new BadRequestException('Choose a time and review the booking terms.');
    if (quote.expires <= Date.now()) {
      const existing = await this.database.withTenantTransaction(
        { tenantId },
        (tx) =>
          tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND request_key=${quote.selection!.requestKey}::uuid`,
      );
      if (!existing.length)
        throw new BadRequestException('This quote has expired. Choose a time again.');
    }
    const reservation = await this.reservations.create(
      tenantId,
      venueId,
      null,
      {
        ...quote.selection,
        guestName: raw.guestName,
        guestEmail: raw.guestEmail,
        guestPhone: raw.guestPhone,
        notes: raw.notes,
        source: 'other',
      },
      true,
    );
    return {
      ...this.safeReservation(reservation),
      accessToken: this.sign({
        tenantId,
        venueId,
        kind: 'reservation',
        reservationId: reservation.id,
        expires: Math.max(Date.now(), new Date(reservation.startsAt).getTime()) + 30 * 86400_000,
      }),
    };
  }

  async status(tenantId: string, venueId: string, reservationId: string, authorization?: string) {
    const token = this.verify(
      authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined,
      tenantId,
      venueId,
      'reservation',
    );
    if (token.reservationId !== reservationId)
      throw new NotFoundException('Reservation was not found.');
    return this.safeReservation(await this.reservations.get(tenantId, venueId, reservationId));
  }

  private safeReservation(row: Awaited<ReturnType<VenueReservationsService['get']>>) {
    const value = row as typeof row & {
      checkout?: { state: string; url: string | null };
      paymentHoldExpiresAt?: Date | null;
      depositTerms?: { amount: string; currency: string };
    };
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      partySize: row.partySize,
      paymentHoldExpiresAt: value.paymentHoldExpiresAt,
      checkout: value.checkout?.state === 'READY' ? { url: value.checkout.url } : null,
      deposit: value.depositTerms
        ? { amount: value.depositTerms.amount, currency: value.depositTerms.currency }
        : null,
    };
  }

  private object(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('A JSON object is required.');
    return body as Record<string, unknown>;
  }
  private key() {
    const configured =
      process.env.RESTAURANT_GUEST_SIGNING_SECRET ?? process.env.QUOTE_SIGNING_SECRET;
    if (!configured && process.env.NODE_ENV === 'production')
      throw new Error('RESTAURANT_GUEST_SIGNING_SECRET is required in production.');
    return configured ?? localSigningKey;
  }
  private signature(value: string) {
    return createHmac('sha256', this.key()).update(`restaurant-v1:${value}`).digest('base64url');
  }
  private sign(value: Token) {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encoded}.${this.signature(encoded)}`;
  }
  private verify(
    raw: unknown,
    tenantId: string,
    venueId: string,
    kind: Token['kind'],
    allowExpired = false,
  ): Token {
    try {
      if (typeof raw !== 'string' || raw.length > 6000) throw new Error();
      const [encoded, supplied, extra] = raw.split('.');
      if (!encoded || !supplied || extra) throw new Error();
      const expected = Buffer.from(this.signature(encoded)),
        signature = Buffer.from(supplied);
      if (expected.length !== signature.length || !timingSafeEqual(expected, signature))
        throw new Error();
      const token = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Token;
      if (
        token.tenantId !== tenantId ||
        token.venueId !== venueId ||
        token.kind !== kind ||
        !Number.isFinite(token.expires) ||
        (!allowExpired && token.expires <= Date.now())
      )
        throw new Error();
      return token;
    } catch {
      throw new BadRequestException('This booking link has expired or is invalid.');
    }
  }
}
