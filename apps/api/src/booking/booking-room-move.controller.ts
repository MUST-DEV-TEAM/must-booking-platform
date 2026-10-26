import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { MoveBookingRoomCommand } from '@must/domain-contracts';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PmsProviderRegistry } from './pms-provider-registry';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
type Context = { tenantId: string; propertyId: string; userId: string };
type Request = { tenantContext: Context };
@Controller('tenants/:tenantId/properties/:propertyId/bookings')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
@RequiresCapability('bookings.edit')
export class BookingRoomMoveController {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PmsProviderRegistry) private readonly providers: PmsProviderRegistry,
  ) {}
  private async evidence(c: Context, id: string) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Choose a valid reservation.');
    return this.db.withTenantTransaction(c, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          version: number;
          roomId: string | null;
          roomTypeId: string;
          startsOn: string;
          endsOn: string;
          externalBookingId: string | null;
          eligible: boolean;
        }>
      >`SELECT b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.external_booking_id AS "externalBookingId",b.version,b.room_id AS "roomId",b.room_type_id AS "roomTypeId",(b.status='CONFIRMED' AND b.starts_on >= (now() AT TIME ZONE COALESCE(p.timezone,'UTC'))::date AND COALESCE(b.pms_stay_status,'expected')='expected') AS eligible FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${id}::uuid`;
      if (!rows[0]) throw new NotFoundException('Reservation not found.');
      const rooms = await tx.$queryRaw<
        Array<{ id: string; name: string }>
      >`SELECT id,name FROM rooms WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND room_type_id=${rows[0].roomTypeId}::uuid AND is_active ORDER BY name`;
      const pending = await tx.$queryRaw<
        Array<{ key: string; command: MoveBookingRoomCommand }>
      >`SELECT idempotency_key AS key,result->'command' AS command FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND aggregate_id=${id}::uuid AND (idempotency_key LIKE 'clock-room-move:%' OR idempotency_key LIKE 'clock-stay-amend:%') AND status='PENDING' ORDER BY created_at LIMIT 1`;
      return {
        ...rows[0],
        rooms,
        pendingStayChange: pending[0]?.key.startsWith('clock-stay-amend:') ?? false,
        pendingCommand: pending[0]?.key.startsWith('clock-room-move:') ? pending[0].command : null,
      };
    });
  }
  @Get(':bookingId/room-move')
  @TenantScoped({ propertyParam: 'propertyId' })
  async options(@Req() req: Request, @Param('bookingId') id: string) {
    const c = req.tenantContext;
    const { pendingCommand, pendingStayChange, startsOn, endsOn, externalBookingId, ...data } =
      await this.evidence(c, id);
    if (pendingCommand || pendingStayChange || !data.eligible)
      return {
        ...data,
        rooms: [],
        pending: !!pendingCommand || pendingStayChange,
        pendingChange: pendingStayChange ? 'stay' : pendingCommand ? 'room' : null,
      };
    const provider = await this.providers.forProperty(c.tenantId, c.propertyId);
    if (!provider.unavailableRoomsForMove)
      throw new ConflictException('Room availability cannot be verified with this connection.');
    const managedInClock = !!externalBookingId;
    const candidates = data.rooms.filter((room) => room.id !== data.roomId);
    if (!candidates.length) return { ...data, managedInClock, rooms: [], pending: false };
    const checked = await provider.unavailableRoomsForMove(c, {
      roomIds: candidates.map((room) => room.id),
      startsOn,
      endsOn,
      excludeBookingId: id,
      ...(externalBookingId ? { excludeExternalBookingId: externalBookingId } : {}),
    });
    if (!checked.ok) throw new ConflictException(checked.error.message);
    const unavailable = new Set(checked.value.unavailableRoomIds);
    return {
      ...data,
      managedInClock,
      availability: checked.value,
      rooms: candidates.filter((room) => !unavailable.has(room.id)),
      pending: false,
    };
  }
  @Patch(':bookingId/room-move')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  async move(
    @Req() req: Request,
    @Param('bookingId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const b = (body ?? {}) as Record<string, unknown>;
    if (
      typeof b.roomId !== 'string' ||
      !NOTIFICATION_UUID.test(b.roomId) ||
      !Number.isInteger(b.expectedVersion) ||
      Number(b.expectedVersion) < 1 ||
      typeof b.reason !== 'string' ||
      !b.reason.trim() ||
      b.reason.length > 2000 ||
      !key?.trim() ||
      key.length > 160
    )
      throw new BadRequestException('Choose a room, version, reason and a valid request key.');
    const data = await this.evidence(req.tenantContext, id);
    if (data.pendingStayChange)
      throw new ConflictException('Verify the saved stay change before moving rooms.');
    if (!data.eligible)
      throw new ConflictException('Only upcoming, confirmed reservations can be reassigned here.');
    return this.execute(req.tenantContext, {
      bookingId: id,
      roomId: b.roomId,
      expectedVersion: Number(b.expectedVersion),
      reason: b.reason.trim(),
      idempotencyKey: key,
      staffActorId: req.tenantContext.userId,
    });
  }
  @Post(':bookingId/room-move/check')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  async check(@Req() req: Request, @Param('bookingId') id: string) {
    const data = await this.evidence(req.tenantContext, id);
    if (data.pendingStayChange)
      throw new ConflictException('Use the saved stay-change verification before moving rooms.');
    if (!data.pendingCommand) return { ok: true, value: { pending: false } };
    // Replay the durable original intent. The adapter only reads back an uncertain
    // operation and cannot send a second provider update on this path.
    return this.execute(req.tenantContext, data.pendingCommand);
  }
  private async execute(c: Context, command: MoveBookingRoomCommand) {
    const provider = await this.providers.forProperty(c.tenantId, c.propertyId);
    if (!provider.moveBookingRoom)
      throw new ConflictException('This provider does not support room reassignment.');
    return provider.moveBookingRoom(c, command);
  }
}
