import { CapabilitiesService } from './capabilities.service';
import {
  Body,
  ForbiddenException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { InventoryStockService } from './inventory-stock.service';
import { AvailabilityService } from './availability.service';
import { RequiresCapability } from './capabilities.decorator';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId')
export class AvailabilityController {
  constructor(
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(InventoryStockService) private readonly stock: InventoryStockService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  /** Staff-accessible (calendar.view, not settings.manage) — the walk-in
   * booking form needs to know whether to show a Rate Plan picker (local
   * pricing needs one) or derive it automatically (Clock-priced). */
  @Get('pms-connection-status')
  @TenantScoped({ propertyParam: 'propertyId' })
  async getPmsConnectionStatus(
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    const capabilities = await this.capabilities.effective(request.tenantContext);
    if (
      ![
        'calendar.view',
        'bookings.view',
        'guests.view',
        'rates.manage',
        'rooms.manage',
        'settings.manage',
      ].some((c) => capabilities.includes(c))
    )
      throw new ForbiddenException('Hotel source information is not available to this role.');
    const connection = await this.connections.activePmsConnectionCredentials(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
    return { provider: connection?.provider === 'CLOCK_PMS' ? 'CLOCK_PMS' : 'LOCAL' };
  }

  @Get('booking-rules/evaluate')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  evaluateRules(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.evaluateRules(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }

  @Get('availability')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  getAvailability(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.getAvailability(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }

  @Get('availability-calendar')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  getCalendar(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.getCalendar(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      this.calendarInput(query),
    );
  }

  @Get('rooms/:roomId/availability')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  getRoomAvailability(
    @Param('roomId') roomId: string,
    @Query() query: unknown,
    @Req() request: TenantPropertyRequest,
  ) {
    return this.availability.getRoomAvailability(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      query,
    );
  }

  @Put('inventory-units')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  async setInventory(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    await this.stock.apply(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
      key,
    );
  }

  @Put('rooms/:roomId/availability')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  setRoomAvailability(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.availability.setRoomAvailability(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post('availability-blocks')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  createAvailabilityBlock(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.availability.createAvailabilityBlock(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Get('availability-blocks')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  listAvailabilityBlocks(@Req() request: TenantPropertyRequest) {
    return this.availability.listAvailabilityBlocks(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Delete('availability-blocks/:availabilityBlockId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  removeAvailabilityBlock(
    @Param('availabilityBlockId') availabilityBlockId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.availability.removeAvailabilityBlock(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      availabilityBlockId,
      request.tenantContext.userId,
    );
  }

  private calendarInput(query: unknown): {
    roomTypeId: string;
    roomId?: string;
    month: string;
    roomCount?: number;
  } {
    const value = (query ?? {}) as Record<string, unknown>;
    const roomCount = Number(value.rooms);
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      month: typeof value.month === 'string' ? value.month : '',
      roomCount:
        Number.isInteger(roomCount) && roomCount >= 1 && roomCount <= 25 ? roomCount : undefined,
    };
  }
}
