import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { QuoteService } from '../booking/quote.service';
import { ManualPaymentService } from '../payments/manual-payment.service';
import { PaymentRefundService } from '../payments/payment-refund.service';
import { AmenitiesService } from './amenities.service';
import { AvailabilityService } from './availability.service';
import { PropertiesService } from './properties.service';
import { RatePlansService } from './rate-plans.service';
import { RoomTypesService } from './room-types.service';
import { RoomsService } from './rooms.service';
import { TenantDatabaseService } from './tenant-database.service';

const demoPropertyName = 'MUST Local Demo Hotel';
const demoStartOffset = -62;
const demoEndOffset = 63;

export type LocalDemoSeedResult = {
  property: { id: string; name: string; created: boolean };
  provisionedStaff: Array<{
    userId: string;
    email: string;
    password: string | null;
    roleTemplateName: string;
  }>;
  createdBookings: number;
  reusedBookings: number;
};

@Injectable()
export class LocalDemoSeedService {
  constructor(
    @Inject(PropertiesService) private readonly properties: PropertiesService,
    @Inject(RoomTypesService) private readonly roomTypes: RoomTypesService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(AmenitiesService) private readonly amenities: AmenitiesService,
    @Inject(RatePlansService) private readonly ratePlans: RatePlansService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(ManualPaymentService) private readonly payments: ManualPaymentService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async seed(tenantId: string, actorUserId: string): Promise<LocalDemoSeedResult> {
    this.requireLocalDevelopment();
    const resolved = await this.resolveSecondProperty(tenantId, actorUserId);
    const { id: propertyId } = resolved.property;
    const context = { tenantId, propertyId };
    await this.properties.updatePaymentGateways(tenantId, propertyId, actorUserId, {
      stripe: false,
      pokpay: false,
      payAtHotel: true,
    });

    const [standard, family] = await Promise.all([
      this.roomType(tenantId, propertyId, actorUserId, 'Demo Standard King', 2),
      this.roomType(tenantId, propertyId, actorUserId, 'Demo Family Suite', 4),
    ]);
    await Promise.all([
      ...['101', '102', '103', '104', '105', '106'].map((name) =>
        this.room(tenantId, propertyId, standard.id, actorUserId, name),
      ),
      ...['201', '202', '203', '204'].map((name) =>
        this.room(tenantId, propertyId, family.id, actorUserId, name),
      ),
    ]);
    const amenityIds = await Promise.all(
      ['Breakfast included', 'Fast Wi-Fi', 'Airport transfer'].map((name) =>
        this.amenity(tenantId, propertyId, actorUserId, name),
      ),
    );
    await Promise.all([
      this.amenities.setRoomTypeAmenities(tenantId, propertyId, standard.id, actorUserId, {
        amenityIds: amenityIds.slice(0, 2),
      }),
      this.amenities.setRoomTypeAmenities(tenantId, propertyId, family.id, actorUserId, {
        amenityIds,
      }),
    ]);

    const ratePlan = await this.ratePlan(tenantId, propertyId, actorUserId);
    await Promise.all([
      this.baseRate(tenantId, propertyId, ratePlan.id, standard.id, actorUserId, '110.00'),
      this.baseRate(tenantId, propertyId, ratePlan.id, family.id, actorUserId, '175.00'),
      this.availability.setInventory(tenantId, propertyId, actorUserId, {
        roomTypeId: standard.id,
        startsOn: dateFromToday(demoStartOffset),
        endsOn: dateFromToday(demoEndOffset),
        availableUnits: 6,
      }),
      this.availability.setInventory(tenantId, propertyId, actorUserId, {
        roomTypeId: family.id,
        startsOn: dateFromToday(demoStartOffset),
        endsOn: dateFromToday(demoEndOffset),
        availableUnits: 4,
      }),
    ]);

    let createdBookings = 0;
    let reusedBookings = 0;
    const specs = bookingSpecs();
    for (const [index, spec] of specs.entries()) {
      const reference = `must-local-demo-${index + 1}`;
      let booking = await this.bookings.findBookingByExternalReference(context, reference);
      if (!booking) {
        const roomType = spec.family ? family : standard;
        const total = await this.quotes.price(tenantId, propertyId, {
          roomTypeId: roomType.id,
          ratePlanId: ratePlan.id,
          startsOn: dateFromToday(spec.startOffset),
          endsOn: dateFromToday(spec.endOffset),
        });
        const result = await this.bookings.createBooking(context, {
          roomTypeId: roomType.id,
          ratePlanId: ratePlan.id,
          startsOn: dateFromToday(spec.startOffset),
          endsOn: dateFromToday(spec.endOffset),
          guest: {
            email: `demo.guest.${index + 1}@must-booking.local`,
            firstName: `Demo${index + 1}`,
            lastName: 'Guest',
            phone: null,
          },
          total,
          idempotencyKey: `must-local-demo-booking-${index + 1}`,
          externalReference: reference,
          paymentMethod: 'pay_at_hotel',
          payAtHotel: true,
          staffActorId: actorUserId,
          skipQuoteValidation: true,
        });
        if (!result.ok) throw new BadRequestException(result.error.message);
        booking = result.value;
        createdBookings += 1;
      } else {
        reusedBookings += 1;
      }
      if (spec.payment) {
        const payment = await this.payments.record(context, {
          bookingId: booking.id,
          idempotencyKey: `must-local-demo-payment-${index + 1}`,
          method: index % 2 === 0 ? 'card_in_person' : 'cash',
          actorUserId,
        });
        if (!payment.ok && payment.error.code !== 'PAYMENT_NOT_AVAILABLE')
          throw new BadRequestException(payment.error.message);
      }
      if (spec.refund) {
        const refund = await this.refunds.manualRefund(context, {
          bookingId: booking.id,
          idempotencyKey: `must-local-demo-refund-${index + 1}`,
          actorUserId,
        });
        if (!refund.ok && refund.error.code !== 'REFUND_NOT_AVAILABLE')
          throw new BadRequestException(refund.error.message);
      }
    }
    return { ...resolved, createdBookings, reusedBookings };
  }

  private requireLocalDevelopment(): void {
    if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_LOCAL_DEMO_SEED !== 'true')
      throw new Error(
        'Local demo seeding requires NODE_ENV=development and ALLOW_LOCAL_DEMO_SEED=true.',
      );
  }

  private async resolveSecondProperty(tenantId: string, actorUserId: string) {
    const properties = await this.properties.list(tenantId, actorUserId);
    if (properties.length === 0)
      throw new BadRequestException(
        'The supplied owner/admin does not have access to this tenant.',
      );
    if (properties.length > 2)
      throw new BadRequestException(
        'Local demo seeding only supports a tenant with one or two properties.',
      );
    if (properties.length === 2)
      return {
        property: { id: properties[1].id, name: properties[1].name, created: false },
        provisionedStaff: await this.provisionedStaff(tenantId, properties[1].id),
      };
    const created = await this.properties.create(tenantId, actorUserId, {
      name: demoPropertyName,
      address: '29 Demo Avenue, Tirana',
      timezone: 'Europe/Tirane',
    });
    return {
      property: { id: created.id, name: created.name, created: true },
      provisionedStaff: created.provisionedStaff,
    };
  }

  private async provisionedStaff(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<LocalDemoSeedResult['provisionedStaff']>`
        SELECT u.id AS "userId", u.email, NULL::text AS password, prt.name AS "roleTemplateName"
        FROM property_staff_assignments psa
        JOIN users u ON u.id = psa.user_id
        JOIN property_role_templates prt
          ON prt.tenant_id = psa.tenant_id AND prt.property_id = psa.property_id
          AND prt.id = psa.role_template_id
        WHERE psa.tenant_id = ${tenantId}::uuid AND psa.property_id = ${propertyId}::uuid
          AND prt.name IN ('Front Desk', 'Property Manager', 'Finance')
        ORDER BY prt.name
      `,
    );
  }

  private async roomType(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    name: string,
    maxOccupancy: number,
  ) {
    const existing = (await this.roomTypes.list(tenantId, propertyId)).find(
      (roomType) => roomType.name === name,
    );
    return (
      existing ?? this.roomTypes.create(tenantId, propertyId, actorUserId, { name, maxOccupancy })
    );
  }

  private async room(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    name: string,
  ) {
    const existing = await this.rooms.list(tenantId, propertyId, roomTypeId);
    if (!existing.some((room) => room.name === name))
      await this.rooms.create(tenantId, propertyId, roomTypeId, actorUserId, { name });
  }

  private async amenity(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    name: string,
  ): Promise<string> {
    const existing = (await this.amenities.list(tenantId, propertyId)).find(
      (amenity) => amenity.name === name,
    );
    return (existing ?? (await this.amenities.create(tenantId, propertyId, actorUserId, { name })))
      .id;
  }

  private async ratePlan(tenantId: string, propertyId: string, actorUserId: string) {
    const name = 'Demo Flexible Rate';
    const existing = (await this.ratePlans.list(tenantId, propertyId)).find(
      (plan) => plan.name === name,
    );
    return (
      existing ??
      this.ratePlans.create(tenantId, propertyId, actorUserId, {
        name,
        currency: 'EUR',
        isActive: true,
        freeCancellationUntilHours: 0,
      })
    );
  }

  private async baseRate(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    roomTypeId: string,
    actorUserId: string,
    amount: string,
  ) {
    const existing = await this.ratePlans.listRules(tenantId, propertyId, ratePlanId);
    if (!existing.some((rule) => rule.roomTypeId === roomTypeId && rule.startsOn === null))
      await this.ratePlans.createRule(tenantId, propertyId, ratePlanId, actorUserId, {
        roomTypeId,
        startsOn: null,
        endsOn: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        amount,
      });
  }
}

const dateFromToday = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const bookingSpecs = () =>
  [
    [-58, -55, false, true, false],
    [-51, -47, true, true, false],
    [-43, -40, false, true, false],
    [-35, -31, true, true, false],
    [-27, -24, false, true, false],
    [-19, -16, true, true, true],
    [-12, -9, false, true, false],
    [-6, -3, true, false, false],
    [-2, 1, false, true, false],
    [0, 3, true, true, false],
    [4, 7, false, true, false],
    [9, 13, true, false, false],
    [16, 19, false, true, false],
    [24, 28, true, false, false],
    [34, 37, false, true, false],
    [48, 52, true, false, false],
    [57, 60, false, true, false],
  ].map(([startOffset, endOffset, family, payment, refund]) => ({
    startOffset: startOffset as number,
    endOffset: endOffset as number,
    family: family as boolean,
    payment: payment as boolean,
    refund: refund as boolean,
  }));
