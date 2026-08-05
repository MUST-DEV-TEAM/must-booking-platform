import { Controller, Get, Inject, Req } from '@nestjs/common';

import { TenantScoped } from './tenant-context.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { RoomsService } from './rooms.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

/** Flat, property-wide room list — the walk-in booking form's "All" room
 * type option needs every room regardless of type, unlike RoomsController
 * which is always scoped to one room type at a time. */
@Controller('tenants/:tenantId/properties/:propertyId/rooms')
export class PropertyRoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  list(@Req() request: TenantPropertyRequest) {
    return this.rooms.listAll(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }
}
