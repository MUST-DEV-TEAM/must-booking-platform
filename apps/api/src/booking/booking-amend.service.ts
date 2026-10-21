import { PaymentRefundService, type RefundConfirmation } from '../payments/payment-refund.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { AvailabilityService } from '../tenancy/availability.service';
import { pricingContext, pricingFacts } from '../tenancy/pricing.repository';
import { applicableRestrictions } from '../tenancy/inventory-restrictions.repository';
import { evaluatePricing, minor } from './pricing-evaluator';
import {
  evaluateBookingRules,
  rangeViolation,
  ruleNights,
  type BookingRulePolicy,
} from './booking-rules';
import { BookingUpdateNotificationService } from '../mail/booking-update-notification.service';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
type Context = { tenantId: string; propertyId: string; userId: string };
type Outcome = 'charge' | 'waive' | 'refund' | 'no_refund' | 'refund_due' | 'equal';
type Choice = { outcome?: Outcome; outcomeReason: string };
type Dates = { startsOn: string; endsOn: string };
type Row = Dates & {
  id: string;
  version: number;
  status: string;
  roomTypeId: string;
  roomId: string | null;
  ratePlanId: string;
  total: string;
  currency: string;
  adults: number;
  children: number;
  externalBookingId: string | null;
  pmsStayStatus: string | null;
  orderReference: string | null;
  paid: string;
  refunded: string;
  roomTypeStatus: string;
  maxOccupancy: number;
  roomActive: boolean | null;
};
const money = (n: bigint): string =>
  n < 0n ? '-' + money(-n) : `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class BookingAmendService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly caps: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(BookingUpdateNotificationService)
    private readonly emails: BookingUpdateNotificationService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly receipts: PaymentNotificationService,
  ) {}
  private async require(c: Context, id: string) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Choose a valid reservation.');
    const capabilities = await this.caps.effective(c);
    if (!capabilities.includes('bookings.edit'))
      throw new ForbiddenException('Requires bookings.edit.');
    return capabilities;
  }
  private dates(value: unknown): Dates {
    const raw = (value ?? {}) as Record<string, unknown>;
    const d = {
      startsOn: typeof raw.startsOn === 'string' ? raw.startsOn : '',
      endsOn: typeof raw.endsOn === 'string' ? raw.endsOn : '',
    };
    const error = rangeViolation(d.startsOn, d.endsOn);
    if (error) throw new BadRequestException(error.message);
    if (ruleNights(d.startsOn, d.endsOn) > 366)
      throw new BadRequestException('Choose a stay of no more than 366 nights.');
    return d;
  }
  private choice(value: unknown): Choice {
    const raw = (value ?? {}) as Record<string, unknown>;
    if (
      raw.outcome !== undefined &&
      !['charge', 'waive', 'refund', 'no_refund', 'refund_due', 'equal'].includes(
        String(raw.outcome),
      )
    )
      throw new BadRequestException('Choose a price outcome from the list.');
    if (
      raw.outcomeReason !== undefined &&
      (typeof raw.outcomeReason !== 'string' || raw.outcomeReason.trim().length > 2000)
    )
      throw new BadRequestException('Keep the price decision reason to 2000 characters or fewer.');
    return {
      outcome: raw.outcome as Outcome | undefined,
      outcomeReason: typeof raw.outcomeReason === 'string' ? raw.outcomeReason.trim() : '',
    };
  }
  async calendar(c: Context, id: string, query: unknown) {
    const capabilities = await this.require(c, id);
    const raw = (query ?? {}) as Record<string, unknown>;
    const dates = this.dates(raw);
    const window = this.dates({ startsOn: raw.from, endsOn: raw.to });
    if (
      ruleNights(window.startsOn, window.endsOn) > 31 ||
      !['start', 'end'].includes(String(raw.edge))
    )
      throw new BadRequestException(
        'Choose a visible calendar window of up to 31 days and a date field.',
      );
    const add = (day: string, n: number) =>
      new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        await this.evidence(tx, c, id, dates, { outcomeReason: '' }, capabilities);
        const days: { date: string; disabled: boolean; reason: string | null }[] = [];
        for (let day = window.startsOn; day < window.endsOn; day = add(day, 1)) {
          const candidate =
            raw.edge === 'start'
              ? {
                  startsOn: day,
                  endsOn:
                    dates.endsOn > day
                      ? dates.endsOn
                      : add(day, ruleNights(dates.startsOn, dates.endsOn)),
                }
              : { startsOn: dates.startsOn, endsOn: day };
          if (
            candidate.endsOn <= candidate.startsOn ||
            ruleNights(candidate.startsOn, candidate.endsOn) > 366
          ) {
            days.push({
              date: day,
              disabled: true,
              reason: 'Choose check-out after check-in, within 366 nights.',
            });
            continue;
          }
          const p = (await this.evidence(tx, c, id, candidate, { outcomeReason: '' }, capabilities))
            .preview;
          days.push({
            date: day,
            disabled: !p.available,
            reason: p.available ? null : p.policyNotes.join(' '),
          });
        }
        return { days };
      },
      { timeoutMs: 20000 },
    );
  }
  async preview(c: Context, id: string, query: unknown) {
    const capabilities = await this.require(c, id);
    const dates = this.dates(query);
    const choice = this.choice(query);
    return this.db.withTenantTransaction(
      c,
      async (tx) => (await this.evidence(tx, c, id, dates, choice, capabilities)).preview,
      { timeoutMs: 20000 },
    );
  }
  private async evidence(
    tx: TenantTransaction,
    c: Context,
    id: string,
    dates: Dates,
    choice: Choice,
    capabilities: string[],
  ) {
    const property = await pricingContext(tx, c.tenantId, c.propertyId, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${c.tenantId}:${c.propertyId}:booking:${id}`},0))`;
    // Take the row lock in its own statement so ledger reads get a fresh snapshot
    // after any concurrent refund holding this booking lock has committed.
    await tx.$queryRaw`SELECT id FROM bookings WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const rows = await tx.$queryRaw<
      Row[]
    >`SELECT b.id,b.version,b.order_reference AS "orderReference",b.status::text,b.pms_stay_status AS "pmsStayStatus",b.room_type_id AS "roomTypeId",b.room_id AS "roomId",b.rate_plan_id AS "ratePlanId",b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.total_amount::text AS total,b.external_booking_id AS "externalBookingId",b.adults,b.children,rp.currency,rt.status::text AS "roomTypeStatus",rt.max_occupancy AS "maxOccupancy",r.is_active AS "roomActive",
  COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','LATE_AFTER_EXPIRY','succeeded')),0)::text AS paid,
  COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS refunded
  FROM bookings b JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
  JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id
  LEFT JOIN rooms r ON r.tenant_id=b.tenant_id AND r.property_id=b.property_id AND r.id=b.room_id
  WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${id}::uuid `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Reservation not found in this hotel.');
    if (property.readOnly || row.externalBookingId)
      throw new ConflictException('This reservation is managed in Clock. Change dates there.');
    if (!['CONFIRMED', 'PAYMENT_NOT_REQUIRED'].includes(row.status))
      throw new ConflictException(
        'Dates can only be changed on a confirmed reservation without a pending checkout.',
      );
    if (row.pmsStayStatus === 'checked_out' || row.endsOn <= property.today)
      throw new ConflictException(
        'This stay has ended or reaches checkout today. Its dates cannot be changed here.',
      );
    if (row.orderReference) {
      const allocation = await tx.$queryRaw<{ ambiguous: boolean }[]>`SELECT
        count(*) FILTER (WHERE b.total_amount>0)>1 AND
        (SELECT count(*) FROM payments p JOIN bookings member ON member.tenant_id=p.tenant_id AND member.property_id=p.property_id AND member.id=p.booking_id
          WHERE member.tenant_id=${c.tenantId}::uuid AND member.property_id=${c.propertyId}::uuid AND member.order_reference=${row.orderReference}
          AND p.kind='CHARGE' AND p.status IN ('PAID','LATE_AFTER_EXPIRY','succeeded'))=1 AS ambiguous
        FROM bookings b WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.order_reference=${row.orderReference}`;
      if (allocation[0]?.ambiguous)
        throw new ConflictException(
          'We cannot tell how the order payment is split between reservations. Ask finance to review it before changing dates.',
        );
    }
    const policies = await tx.$queryRaw<
      BookingRulePolicy[]
    >`SELECT same_day_booking_allowed AS "sameDayBookingAllowed",same_day_cutoff_time AS "sameDayCutoffTime",max_guests_per_booking AS "maxGuestsPerBooking",max_rooms_per_booking AS "maxRoomsPerBooking",timezone,min_stay_nights AS "minStayNights",max_stay_nights AS "maxStayNights",advance_booking_days AS "advanceBookingDays" FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
    const restrictions = await applicableRestrictions(tx, c.tenantId, c.propertyId, row.roomTypeId);
    const rules = evaluateBookingRules({
      ...dates,
      channel: 'staff',
      policy: policies[0],
      restrictions,
      adults: row.adults,
      children: row.children,
      maxOccupancy: row.maxOccupancy,
      roomTypeStatus: row.roomTypeStatus,
      roomActive: row.roomId ? row.roomActive === true : undefined,
    });
    const pricing = evaluatePricing(await pricingFacts(tx, c.tenantId, c.propertyId), {
      ...dates,
      roomTypeId: row.roomTypeId,
      ratePlanId: row.ratePlanId,
      ...(row.roomId ? { roomId: row.roomId } : {}),
      adults: row.adults,
      children: row.children,
      channel: 'staff',
      today: property.today,
    });
    const inventoryInput = {
      ...dates,
      bookingId: id,
      roomTypeId: row.roomTypeId,
      roomId: row.roomId,
      oldStartsOn: row.startsOn,
      oldEndsOn: row.endsOn,
    };
    const stockReasons: string[] = [];
    const stock =
      rules.valid &&
      (await this.availability.amendStayInventory(
        tx,
        c.tenantId,
        c.propertyId,
        inventoryInput,
        false,
        stockReasons,
      ));
    const notes = [...rules.errors.map((e) => e.message), ...pricing.errors.map((e) => e.message)];
    if (!stock && rules.valid)
      notes.push(
        stockReasons.join(' ') || 'The same room or room type is unavailable for these dates.',
      );
    if (pricing.total && pricing.total.currency !== row.currency)
      notes.push('The rate plan currency changed. This stay cannot be repriced safely.');
    const available =
      stock &&
      rules.valid &&
      pricing.valid &&
      !!pricing.total &&
      pricing.total.currency === row.currency;
    const total = pricing.total?.amount ?? null;
    const difference = total === null ? null : minor(total) - minor(row.total);
    const canRefund = capabilities.includes('payments.refund');
    const availableOutcomes: Outcome[] =
      difference === null || difference === 0n
        ? ['equal']
        : difference > 0n
          ? canRefund
            ? ['charge', 'waive']
            : ['charge']
          : canRefund
            ? ['refund', 'no_refund', 'refund_due']
            : ['refund_due'];
    const outcome = choice.outcome ?? availableOutcomes[0]!;
    if (!availableOutcomes.includes(outcome)) {
      if ((outcome === 'waive' || outcome === 'no_refund' || outcome === 'refund') && !canRefund)
        throw new ForbiddenException('Requires payments.refund for this price decision.');
      throw new BadRequestException('This price outcome does not match the price change.');
    }
    const recordedTotal = outcome === 'waive' || outcome === 'no_refund' ? row.total : total;
    const netPaid = minor(row.paid) - minor(row.refunded);
    const refundAmount =
      outcome === 'refund' && difference !== null && difference < 0n && total !== null
        ? [-difference, netPaid - minor(total)].reduce((a, b) => (a < b ? a : b))
        : 0n;
    const refundToIssue = refundAmount > 0n ? refundAmount : 0n;
    const balance = recordedTotal === null ? null : minor(recordedTotal) - netPaid + refundToIssue;
    const preview = {
      bookingId: id,
      ...dates,
      nights: ruleNights(dates.startsOn, dates.endsOn),
      available,
      oldTotal: row.total,
      newTotal: total,
      currency: row.currency,
      difference: difference === null ? null : money(difference),
      recordedTotal,
      outcome,
      outcomeReason: choice.outcomeReason,
      availableOutcomes,
      canRefund,
      refundToIssue: money(refundToIssue),
      paid: row.paid,
      refunded: row.refunded,
      balance: balance === null ? null : money(balance),
      balanceState:
        balance === null
          ? 'unknown'
          : balance < 0n
            ? 'refund_due'
            : balance > 0n
              ? 'due'
              : 'settled',
      policyNotes: notes,
      version: row.version,
    };
    return {
      row,
      inventoryInput,
      pricing,
      preview: {
        ...preview,
        previewHash: hash({ tenantId: c.tenantId, propertyId: c.propertyId, preview, pricing }),
      },
    };
  }
  async amend(c: Context, id: string, body: unknown, key: string | undefined) {
    const capabilities = await this.require(c, id);
    const choice = this.choice(body);
    const raw = (body ?? {}) as Record<string, unknown>,
      dates = this.dates(body);
    if (
      Object.keys(raw).some(
        (k) =>
          ![
            'startsOn',
            'endsOn',
            'expectedVersion',
            'previewHash',
            'reason',
            'notifyGuest',
            'outcome',
            'outcomeReason',
          ].includes(k),
      )
    )
      throw new BadRequestException('Only dates can be changed here.');
    if (
      !Number.isSafeInteger(raw.expectedVersion) ||
      Number(raw.expectedVersion) < 1 ||
      typeof raw.previewHash !== 'string'
    )
      throw new BadRequestException('Preview these dates before confirming.');
    if (typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.trim().length > 2000)
      throw new BadRequestException('Enter a reason of up to 2000 characters.');
    if (raw.notifyGuest !== undefined && typeof raw.notifyGuest !== 'boolean')
      throw new BadRequestException('Choose whether to notify the guest.');
    if (!key?.trim() || key.length > 200)
      throw new BadRequestException('An Idempotency-Key of up to 200 characters is required.');
    const input = {
      ...dates,
      ...choice,
      expectedVersion: raw.expectedVersion,
      previewHash: raw.previewHash,
      reason: raw.reason.trim(),
      notifyGuest: raw.notifyGuest === true,
    };
    const operationKey = `booking-amend:${key.trim()}`,
      requestHash = hash({ id, actor: c.userId, input });
    let refundReceipt: RefundConfirmation | null = null;
    let previous: { startsOn: string; endsOn: string; roomTypeId: string } | undefined;
    const result = await this.db.withTenantTransaction(
      c,
      async (tx) => {
        const inserted = await tx.$queryRaw<
          { id: string }[]
        >`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${operationKey},${id}::uuid,${requestHash},'PENDING') ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id`;
        if (!inserted[0]) {
          const prior = await tx.$queryRaw<
            { hash: string; result: unknown }[]
          >`SELECT request_hash AS hash,result FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${operationKey} FOR UPDATE`;
          if (prior[0]?.hash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different date change.',
            );
          if (!prior[0].result)
            throw new ConflictException(
              'This date change is in progress. Retry with the same key.',
            );
          return prior[0].result;
        }
        const evidence = await this.evidence(tx, c, id, dates, choice, capabilities),
          p = evidence.preview,
          row = evidence.row;
        if (p.version !== input.expectedVersion || p.previewHash !== input.previewHash)
          throw new ConflictException(
            'This reservation or preview changed. Review the dates and price again.',
          );
        if (['waive', 'no_refund'].includes(p.outcome) && !choice.outcomeReason)
          throw new BadRequestException('Enter a reason for this price decision.');
        if (!p.available)
          throw new ConflictException(p.policyNotes.join(' ') || 'These dates are unavailable.');
        if (dates.startsOn === row.startsOn && dates.endsOn === row.endsOn)
          throw new BadRequestException('Choose different dates.');
        if (
          !(await this.availability.amendStayInventory(
            tx,
            c.tenantId,
            c.propertyId,
            evidence.inventoryInput,
            true,
          ))
        )
          throw new ConflictException('These dates are no longer available. Nothing was changed.');
        const updated =
          await tx.$executeRaw`UPDATE bookings SET starts_on=${dates.startsOn}::date,ends_on=${dates.endsOn}::date,total_amount=${p.recordedTotal}::numeric,nightly_rates=${JSON.stringify(evidence.pricing.nightlyRates)}::jsonb,version=version+1,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND version=${input.expectedVersion}`;
        if (updated !== 1)
          throw new ConflictException('This reservation changed. Reload it before confirming.');
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: 'booking.dates_amended',
          targetType: 'booking',
          targetId: id,
          details: {
            changes: {
              startsOn: { old: row.startsOn, new: dates.startsOn },
              endsOn: { old: row.endsOn, new: dates.endsOn },
              total: { old: row.total, new: p.recordedTotal },
              'Price decision': {
                old: 'Not decided',
                new: {
                  charge: 'Charge the difference',
                  waive: 'Waive the difference',
                  refund: 'Refund the difference',
                  no_refund: "Don't refund",
                  refund_due: 'Leave refund due',
                  equal: 'Keep price',
                }[p.outcome],
              },
              'Priced difference': { old: '0.00', new: `${p.currency} ${p.difference}` },
              ...(p.outcomeReason
                ? { 'Price decision reason': { old: null, new: p.outcomeReason } }
                : {}),
            },
            difference: p.difference,
            pricedTotal: p.newTotal,
            outcome: p.outcome,
            outcomeReason: p.outcomeReason,
            reason: input.reason,
            notifyGuest: input.notifyGuest,
          },
        });
        if (minor(p.refundToIssue) > 0n) {
          const refunded = await this.refunds.refundPaidChargeForBookingAmount(
            tx,
            c,
            id,
            { amount: p.refundToIssue, currency: p.currency },
            `booking-amend-refund:${key.trim()}`,
            { actorUserId: c.userId, note: input.reason },
          );
          if (!refunded.result.ok) throw new ConflictException(refunded.result.error.message);
          if (!refunded.result.value)
            throw new ConflictException(
              'The paid charge cannot be refunded here. Leave a refund due for a manager.',
            );
          refundReceipt = refunded.confirmation;
        }
        const saved = {
          ok: true,
          version: row.version + 1,
          startsOn: dates.startsOn,
          endsOn: dates.endsOn,
          total: p.recordedTotal,
          oldTotal: row.total,
          reason: input.reason,
          pricedTotal: p.newTotal,
          difference: p.difference,
          outcome: p.outcome,
          outcomeReason: p.outcomeReason,
          refundIssued: p.refundToIssue,
          currency: p.currency,
          balance: p.balance,
          balanceState: p.balanceState,
        };
        await tx.$executeRaw`UPDATE integration_operations SET status='SUCCEEDED',result=${JSON.stringify(saved)}::jsonb,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${operationKey}`;
        if (input.notifyGuest)
          previous = { startsOn: row.startsOn, endsOn: row.endsOn, roomTypeId: row.roomTypeId };
        return saved;
      },
      { timeoutMs: 20000 },
    );
    if (refundReceipt) await this.receipts.sendRefundConfirmationEmailSafely(refundReceipt, c);
    if (previous) await this.emails.sendBookingChanged(c, id, previous);
    return result;
  }
}
