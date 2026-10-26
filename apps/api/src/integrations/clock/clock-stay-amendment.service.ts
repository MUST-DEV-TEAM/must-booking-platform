import { Inject, Injectable } from '@nestjs/common';
import type {
  Booking,
  PmsProviderContext,
  Result,
  StayAmendmentCommand,
  StayAmendmentPreview,
  StayAmendmentQuery,
} from '@must/domain-contracts';
import { createHash } from 'node:crypto';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ManualReviewService } from '../manual-review.service';
import { ClockBookingService } from './clock-booking.service';
import { ClockAvailabilityService } from './clock-availability.service';
import { ClockFinancialService } from './clock-financial.service';
import { parseClockCredentials } from './clock-credentials';
import {
  evaluateBookingRules,
  rangeViolation,
  ruleNights,
  type BookingRulePolicy,
} from '../../booking/booking-rules';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// JSONB reorders keys. Request identity must survive that round trip.
const commandHash = (command: StayAmendmentCommand) =>
  digest(
    Object.fromEntries(
      Object.entries(command)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

const minor = (value: string) => {
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return sign * (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)));
};
const money = (value: bigint): string =>
  value < 0n ? '-' + money(-value) : `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
type Row = {
  ref: string;
  id: string;
  version: number;
  status: string;
  external: string;
  startsOn: string;
  endsOn: string;
  roomTypeId: string;
  roomId: string | null;
  externalType: string;
  total: string;
  currency: string;
  adults: number;
  children: number;
  childrenAges: number[] | null;
  orderReference: string | null;
  stayStatus: string | null;
  today: string;
};
type Intent = {
  command: StayAmendmentCommand;
  row: Row;
  preview: StayAmendmentPreview;
  connectionId: string;
  rateId: string;
  room: string | null;
  lockVersion: number;
  policyId: string | null;
  target?: { roomTypeId: string; externalType: string; ratePlanId: string; name: string };
};
const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message, retryable: false },
});
@Injectable()
export class ClockStayAmendmentService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingService) private readonly bookings: ClockBookingService,
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ManualReviewService) private readonly reviews: ManualReviewService,
  ) {}
  private async row(c: PmsProviderContext, id: string) {
    return this.db.withTenantTransaction(c, async (tx) => {
      const rows = await tx.$queryRaw<
        Row[]
      >`SELECT b.external_reference AS ref,b.id,b.version,b.status,b.external_booking_id AS external,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.room_type_id AS "roomTypeId",b.room_id AS "roomId",b.total_amount::text AS total,rp.currency,b.adults,b.children,b.children_ages AS "childrenAges",b.order_reference AS "orderReference",b.pms_stay_status AS "stayStatus",(now() AT TIME ZONE p.timezone)::date::text AS today,m.external_entity_id AS "externalType" FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id JOIN clock_catalog_mappings m ON m.tenant_id=b.tenant_id AND m.property_id=b.property_id AND m.local_entity_id=b.room_type_id AND m.entity_type='ROOM_TYPE' AND m.sync_status='CONFIRMED' JOIN property_integration_connections pc ON pc.tenant_id=m.tenant_id AND pc.property_id=m.property_id AND pc.connection_id=m.connection_id AND pc.kind='PMS' AND pc.enabled WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${id}::uuid`;
      return rows[0] ?? null;
    });
  }
  private async compute(
    c: PmsProviderContext,
    q: StayAmendmentQuery,
  ): Promise<Result<Omit<Intent, 'command'>>> {
    const invalid = rangeViolation(q.startsOn, q.endsOn);
    if (invalid || ruleNights(q.startsOn, q.endsOn) > 366)
      return fail('INVALID_DATES', invalid?.message || 'Choose no more than 366 nights.');
    const row = await this.row(c, q.bookingId);
    if (!row) return fail('BOOKING_NOT_FOUND', 'Linked Clock reservation not found.');
    if (
      row.status !== 'CONFIRMED' ||
      row.startsOn < row.today ||
      q.startsOn < row.today ||
      row.orderReference ||
      (row.stayStatus && row.stayStatus !== 'expected')
    )
      return fail(
        'AMENDMENT_UNAVAILABLE',
        'Only upcoming, confirmed single reservations can change dates here.',
      );
    if (
      q.startsOn === row.startsOn &&
      q.endsOn === row.endsOn &&
      (!q.roomTypeId || q.roomTypeId === row.roomTypeId)
    )
      return fail('UNCHANGED_DATES', 'Choose different dates.');
    const policy = await this.db.withTenantTransaction(
      c,
      (tx) =>
        tx.$queryRaw<
          BookingRulePolicy[]
        >`SELECT timezone,min_stay_nights AS "minStayNights",max_stay_nights AS "maxStayNights",advance_booking_days AS "advanceBookingDays",same_day_booking_allowed AS "sameDayBookingAllowed",same_day_cutoff_time AS "sameDayCutoffTime" FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`,
    );
    const rules = evaluateBookingRules({
      ...q,
      channel: 'staff',
      policy: policy[0],
      adults: row.adults,
      children: row.children,
    });
    if (!rules.valid) return fail('BOOKING_RULE', rules.errors.map((e) => e.message).join(' '));
    const connection = await this.connections.activePmsConnectionCredentials(
      c.tenantId,
      c.propertyId,
    );
    if (connection?.provider !== 'CLOCK_PMS')
      return fail('PROVIDER_REQUIRED', 'Clock is not connected.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return fail('PROVIDER_REQUIRED', 'Clock credentials need review.');
    const read = await this.bookings.amendmentRead(c, row.external);
    if (!read.ok) return read;
    const raw = read.value;
    if (
      String(raw.id) !== row.external ||
      raw.status !== 'expected' ||
      raw.arrival !== row.startsOn ||
      raw.departure !== row.endsOn ||
      String(raw.arrival_room_type_id) !== row.externalType ||
      !Number.isSafeInteger(raw.rate_id) ||
      !Number.isSafeInteger(raw.total_booking_value?.cents) ||
      raw.total_booking_value?.currency !== row.currency ||
      BigInt(raw.total_booking_value!.cents) !== minor(row.total)
    )
      return fail(
        'PROVIDER_CHANGED',
        'Clock changed since this reservation was synchronized. Refresh it before changing dates.',
      );
    const crossType = !!q.roomTypeId && q.roomTypeId !== row.roomTypeId;
    let target: Intent['target'];
    if (crossType) {
      const targets = await this.db.withTenantTransaction(
        c,
        (tx) =>
          tx.$queryRaw<
            Array<{ roomTypeId: string; externalType: string; ratePlanId: string; name: string }>
          >`SELECT rt.id AS "roomTypeId",m.external_entity_id AS "externalType",rp.id AS "ratePlanId",rt.name FROM room_types rt JOIN clock_catalog_mappings m ON m.tenant_id=rt.tenant_id AND m.property_id=rt.property_id AND m.local_entity_id=rt.id AND m.entity_type='ROOM_TYPE' AND m.sync_status='CONFIRMED' AND m.connection_id=${connection.connectionId}::uuid JOIN rate_plans rp ON rp.tenant_id=rt.tenant_id AND rp.property_id=rt.property_id AND rp.clock_shadow_room_type_id=rt.id AND rp.is_active AND rp.currency=${row.currency} JOIN properties p ON p.tenant_id=rt.tenant_id AND p.id=rt.property_id WHERE rt.tenant_id=${c.tenantId}::uuid AND rt.property_id=${c.propertyId}::uuid AND rt.id=${q.roomTypeId}::uuid AND rt.status='PUBLISHED' AND rt.max_occupancy>=${row.adults + row.children} AND p.booking_mode<>'INDIVIDUAL_ROOM_ONLY'`,
      );
      target = targets[0];
      if (!target)
        return fail(
          'ROOM_TYPE_UNAVAILABLE',
          'Choose an active mapped room type with enough capacity and the same currency. Individual-room-only stays need an assigned-room workflow.',
        );
    }
    const selected = await this.availability.selectRateForStay(parsed.value, {
      tenantId: c.tenantId,
      propertyId: c.propertyId,
      roomTypeId: target?.roomTypeId ?? row.roomTypeId,
      externalRoomTypeId: target?.externalType ?? row.externalType,
      startsOn: q.startsOn,
      endsOn: q.endsOn,
      adultCount: row.adults,
      childrenCount: row.children,
      childrenAges: row.childrenAges ?? [],
      ...(crossType ? {} : { requiredRateId: String(raw.rate_id) }),
    });
    if (!selected.ok) return selected;
    if (
      (!crossType && selected.value.rateId !== String(raw.rate_id)) ||
      selected.value.total.currency !== row.currency
    )
      return fail(
        'RATE_CHANGED',
        'The original rate cannot be preserved for these dates. Review in Clock.',
      );
    if (row.roomId && !crossType) {
      const occupied = await this.availability.unavailableRoomsForBooking(
        c.tenantId,
        c.propertyId,
        {
          roomIds: [row.roomId],
          startsOn: q.startsOn,
          endsOn: q.endsOn,
          excludeExternalBookingId: row.external,
        },
      );
      if (!occupied.ok) return occupied;
      if (occupied.value.length)
        return fail(
          'ROOM_UNAVAILABLE',
          'The assigned room is occupied during the new dates. Move the room or choose other dates.',
        );
    }
    let finances;
    try {
      finances = await this.financial.refresh(c, row.id);
    } catch {
      return fail(
        'FINANCIAL_UNVERIFIED',
        'Clock bills and payments could not be verified. Review the financial information before changing dates.',
      );
    }
    if (
      !finances ||
      finances.bookingVersion !== row.version ||
      finances.connectionId !== connection.connectionId ||
      finances.balance.currency !== row.currency
    )
      return fail(
        'FINANCIAL_CHANGED',
        'The reservation or its financial information changed. Preview again.',
      );
    const latest = await this.row(c, row.id);
    if (latest?.version !== row.version)
      return fail('VERSION_CONFLICT', 'The reservation changed. Preview again.');
    const difference = minor(selected.value.total.amount) - minor(row.total),
      balance = minor(finances.balance.amount) + difference;
    const outcome = difference > 0n ? 'charge' : difference < 0n ? 'refund_due' : 'equal';
    const preview: StayAmendmentPreview = {
      ...(target
        ? {
            roomTypeId: target.roomTypeId,
            roomTypeName: target.name,
            rateId: selected.value.rateId,
            confirmationAvailable: (process.env.CLOCK_ROOM_TYPE_AMEND_ALLOWED_PROPERTY_IDS || '')
              .split(',')
              .includes(c.propertyId),
          }
        : {}),
      bookingId: row.id,
      startsOn: q.startsOn,
      endsOn: q.endsOn,
      nights: ruleNights(q.startsOn, q.endsOn),
      available: true,
      oldTotal: row.total,
      newTotal: selected.value.total.amount,
      recordedTotal: selected.value.total.amount,
      difference: money(difference),
      currency: row.currency,
      paid: finances.paid.amount,
      refunded: finances.refunded.amount,
      balance: money(balance),
      balanceState: balance < 0n ? 'refund_due' : balance > 0n ? 'due' : 'settled',
      policyNotes: [
        'Original cancellation terms are retained. A changed arrival or unconfirmed imported policy requires staff review for cancellation.',
        crossType
          ? 'The new room type uses an available public Clock rate. Its previous room assignment is cleared. Review the agreed terms before confirming.'
          : 'Clock must still offer the original public rate. Last-room and private-rate changes may require review in Clock.',
      ],
      version: row.version,
      previewHash: '',
      outcome,
      outcomeReason: '',
      availableOutcomes: [outcome],
      canRefund: false,
      refundToIssue: '0.00',
    };
    preview.previewHash = digest({
      tenantId: c.tenantId,
      propertyId: c.propertyId,
      preview,
      providerVersion: raw.lock_version,
      rateId: raw.rate_id,
      room: raw.arrival_room_id ?? null,
      policyId: raw.guarantee_policy_id ?? null,
      localPaid: finances.localPaid,
      localRefunded: finances.localRefunded,
      connectionId: connection.connectionId,
    });
    return {
      ok: true,
      value: {
        ...(target ? { target } : {}),
        row,
        preview,
        connectionId: connection.connectionId,
        rateId: selected.value.rateId,
        room: crossType || raw.arrival_room_id == null ? null : String(raw.arrival_room_id),
        lockVersion: raw.lock_version,
        policyId: raw.guarantee_policy_id == null ? null : String(raw.guarantee_policy_id),
      },
    };
  }
  async preview(
    c: PmsProviderContext,
    q: StayAmendmentQuery,
  ): Promise<Result<StayAmendmentPreview>> {
    const data = await this.compute(c, q);
    return data.ok ? { ok: true, value: data.value.preview } : data;
  }
  async amend(c: PmsProviderContext, command: StayAmendmentCommand): Promise<Result<Booking>> {
    const key = 'clock-stay-amend:' + c.propertyId + ':' + command.idempotencyKey,
      fingerprint = commandHash(command);
    const existing = await this.db.withTenantTransaction(
      c,
      (tx) =>
        tx.$queryRaw<
          Array<{ hash: string; result: Intent | Result<Booking> }>
        >`SELECT request_hash AS hash,result FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${key}`,
    );
    if (existing[0]) {
      // Legacy pending intents used insertion-order hashes. Compare their durable
      // original command, while still rejecting any changed request contents.
      if (
        existing[0].hash !== fingerprint &&
        !(!('ok' in existing[0].result) && commandHash(existing[0].result.command) === fingerprint)
      )
        return fail('IDEMPOTENCY_KEY_CONFLICT', 'This amendment key belongs to another request.');
      if ('ok' in existing[0].result) return existing[0].result;
      return this.reconcile(c, key, existing[0].result);
    }
    const data = await this.compute(c, command);
    if (!data.ok) return data;
    if (
      data.value.row.version !== command.expectedVersion ||
      data.value.preview.previewHash !== command.previewHash ||
      command.outcome !== data.value.preview.outcome ||
      command.outcomeReason
    )
      return fail(
        'PREVIEW_CHANGED',
        'The reservation, price or balance changed. Review a new preview before confirming.',
      );
    if (data.value.target && data.value.preview.confirmationAvailable !== true)
      return fail(
        'ROOM_TYPE_REVIEW_REQUIRED',
        'The room-type price preview is available. Applying this change is awaiting dedicated Clock sandbox verification.',
      );
    const intent: Intent = { ...data.value, command };
    const prepared = await this.db.withTenantTransaction(c, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
      const pending = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND aggregate_id=${command.bookingId}::uuid AND status='PENDING' AND (idempotency_key LIKE 'clock-stay-amend:%' OR idempotency_key LIKE 'clock-room-move:%')`;
      if (pending.length) return false;
      const rows = await tx.$queryRaw<
        Array<{ version: number; status: string }>
      >`SELECT version,status FROM bookings WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${command.bookingId}::uuid FOR UPDATE`;
      if (rows[0]?.version !== command.expectedVersion || rows[0]?.status !== 'CONFIRMED')
        return false;
      await tx.$executeRaw`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${key},${command.bookingId}::uuid,${fingerprint},'PENDING',${JSON.stringify(intent)}::jsonb)`;
      await this.audit.recordInTransaction(tx, {
        ...c,
        actorUserId: command.staffActorId,
        action: 'booking.stay_change_requested',
        targetType: 'booking',
        targetId: command.bookingId,
        operationId: command.idempotencyKey,
        details: {
          requested: {
            startsOn: command.startsOn,
            endsOn: command.endsOn,
            roomTypeId: command.roomTypeId,
          },
          reason: command.reason,
        },
      });
      return true;
    });
    if (!prepared)
      return fail(
        'AMENDMENT_REQUIRES_REVIEW',
        'The reservation changed or another amendment needs a provider check.',
      );
    const binding = await this.connections.activePmsConnectionCredentials(c.tenantId, c.propertyId);
    if (binding?.connectionId !== intent.connectionId) return this.flag(c, key, intent);
    const write = await this.bookings.amendmentWrite(c, intent.row.external, {
      ...(command.startsOn !== intent.row.startsOn ? { arrival: command.startsOn } : {}),
      ...(command.endsOn !== intent.row.endsOn ? { departure: command.endsOn } : {}),
      ...(intent.target
        ? {
            arrival_room_type_id: Number(intent.target.externalType),
            arrival_room_id: null,
            rate_id: Number(intent.rateId),
          }
        : {}),
      lock_version: intent.lockVersion,
    });
    if (!write.ok) return this.flag(c, key, intent);
    return this.reconcile(c, key, intent);
  }
  private async flag(c: PmsProviderContext, key: string, intent: Intent): Promise<Result<never>> {
    await this.db.withTenantTransaction(c, async (tx) => {
      await this.reviews.recordInTransaction(tx, {
        ...c,
        category: 'SIMULTANEOUS_CHANGE',
        referenceType: 'booking',
        referenceId: intent.row.id,
        message: 'Date amendment needs provider confirmation. Do not send another amendment.',
        context: { operationKey: key },
      });
      await this.audit.recordInTransaction(tx, {
        ...c,
        actorUserId: intent.command.staffActorId,
        action: 'booking.stay_change_unknown',
        targetType: 'booking',
        targetId: intent.row.id,
        operationId: intent.command.idempotencyKey,
        details: {
          reason: 'The provider result has not been verified. No second update was sent.',
        },
      });
    });
    return fail(
      'AMENDMENT_REQUIRES_REVIEW',
      'The date change is not yet verified. Check the provider result; no second update will be sent.',
    );
  }
  private async reconcile(
    c: PmsProviderContext,
    key: string,
    intent: Intent,
  ): Promise<Result<Booking>> {
    const binding = await this.connections.activePmsConnectionCredentials(c.tenantId, c.propertyId);
    if (binding?.connectionId !== intent.connectionId) return this.flag(c, key, intent);
    const check = await this.bookings.amendmentRead(c, intent.row.external);
    if (!check.ok) return this.flag(c, key, intent);
    const raw = check.value,
      q = intent.command;
    if (
      (raw.guarantee_policy_id == null ? null : String(raw.guarantee_policy_id)) !==
        intent.policyId ||
      !Number.isSafeInteger(raw.balance?.cents) ||
      raw.balance?.currency !== intent.preview.currency ||
      BigInt(raw.balance!.cents) !== minor(intent.preview.balance) ||
      String(raw.id) !== intent.row.external ||
      raw.status !== 'expected' ||
      raw.arrival !== q.startsOn ||
      raw.departure !== q.endsOn ||
      String(raw.arrival_room_type_id) !==
        (intent.target?.externalType ?? intent.row.externalType) ||
      String(raw.rate_id) !== intent.rateId ||
      (raw.arrival_room_id == null ? null : String(raw.arrival_room_id)) !== intent.room ||
      !Number.isSafeInteger(raw.total_booking_value?.cents) ||
      raw.total_booking_value?.currency !== intent.preview.currency ||
      BigInt(raw.total_booking_value!.cents) !== minor(intent.preview.newTotal)
    )
      return this.flag(c, key, intent);
    const finalized = await this.db.withTenantTransaction(c, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
      const ops = await tx.$queryRaw<
        Array<{ result: Result<Booking> | Intent }>
      >`SELECT result FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${key} FOR UPDATE`;
      if (ops[0] && 'ok' in ops[0].result) return ops[0].result;
      const rows = await tx.$queryRaw<
        Array<{
          version: number;
          status: string;
          startsOn: string;
          endsOn: string;
          total: string;
          roomTypeId: string;
        }>
      >`SELECT version,status,room_type_id AS "roomTypeId",starts_on::text AS "startsOn",ends_on::text AS "endsOn",total_amount::text AS total FROM bookings WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${q.bookingId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (
        !row ||
        row.status !== 'CONFIRMED' ||
        (row.version !== q.expectedVersion &&
          !(
            row.startsOn === q.startsOn &&
            row.endsOn === q.endsOn &&
            row.total === intent.preview.newTotal &&
            row.roomTypeId === (intent.target?.roomTypeId ?? intent.row.roomTypeId)
          ))
      )
        return fail(
          'VERSION_CONFLICT',
          'The local reservation changed while Clock applied the dates. Reconciliation is required.',
        );
      if (
        row.startsOn !== q.startsOn ||
        row.endsOn !== q.endsOn ||
        row.total !== intent.preview.newTotal ||
        row.roomTypeId !== (intent.target?.roomTypeId ?? intent.row.roomTypeId)
      )
        await tx.$executeRaw`UPDATE bookings SET starts_on=${q.startsOn}::date,ends_on=${q.endsOn}::date,total_amount=${intent.preview.newTotal}::numeric,room_type_id=${intent.target?.roomTypeId ?? intent.row.roomTypeId}::uuid,room_id=${intent.target ? null : intent.row.roomId}::uuid,rate_plan_id=COALESCE(${intent.target?.ratePlanId ?? null}::uuid,rate_plan_id),nightly_rates=NULL,version=version+1,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${q.bookingId}::uuid`;
      await this.audit.recordInTransaction(tx, {
        ...c,
        actorUserId: q.staffActorId,
        action: 'booking.dates_amended',
        operationId: q.idempotencyKey,
        targetType: 'booking',
        targetId: q.bookingId,
        details: {
          changes: {
            ...(intent.target
              ? { roomTypeId: { old: intent.row.roomTypeId, new: intent.target.roomTypeId } }
              : {}),
            startsOn: { old: intent.row.startsOn, new: q.startsOn },
            endsOn: { old: intent.row.endsOn, new: q.endsOn },
            total: { old: intent.row.total, new: intent.preview.newTotal },
          },
          reason: q.reason,
          outcome: intent.preview.outcome,
          refundIssued: '0.00',
          provider: 'CLOCK_PMS',
        },
      });
      // Reuse the scoped projection inside this transaction; no nested database session.
      const data = await tx.$queryRaw<
        Array<{
          version: number;
          updatedAt: Date;
          createdAt: Date;
          guestId: string;
          ratePlanId: string;
          paymentMethod: Booking['paymentMethod'];
          roomId: string | null;
        }>
      >`SELECT version,updated_at AS "updatedAt",created_at AS "createdAt",guest_id AS "guestId",rate_plan_id AS "ratePlanId",payment_method AS "paymentMethod",room_id AS "roomId" FROM bookings WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${q.bookingId}::uuid`;
      const r = data[0],
        result: Result<Booking> = {
          ok: true,
          value: {
            id: q.bookingId,
            tenantId: c.tenantId,
            propertyId: c.propertyId,
            roomTypeId: intent.target?.roomTypeId ?? intent.row.roomTypeId,
            roomId: r.roomId,
            guestId: r.guestId,
            ratePlanId: r.ratePlanId,
            paymentMethod: r.paymentMethod,
            status: 'CONFIRMED' as Booking['status'],
            startsOn: q.startsOn,
            endsOn: q.endsOn,
            total: { amount: intent.preview.newTotal, currency: intent.preview.currency },
            adults: intent.row.adults,
            children: intent.row.children,
            guestCount: intent.row.adults + intent.row.children,
            externalBookingId: intent.row.external,
            externalReference: intent.row.ref,
            version: r.version,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          },
        };
      await tx.$executeRaw`UPDATE integration_operations SET status='SUCCEEDED',request_hash=${commandHash(q)},result=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${key}`;
      await tx.$executeRaw`UPDATE manual_review_items SET status='RESOLVED',resolved_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND reference_id=${q.bookingId} AND context->>'operationKey'=${key} AND status='OPEN'`;
      await tx.$executeRaw`UPDATE clock_sync_jobs SET next_run_at=now(),requested_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND connection_id=${intent.connectionId}::uuid AND resource=${'financial:' + q.bookingId}`;
      return result;
    });
    return finalized.ok ? finalized : this.flag(c, key, intent);
  }
}
