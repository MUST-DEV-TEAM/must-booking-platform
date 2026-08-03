import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { AvailabilityService } from './availability.service';
import { RequiresCapability } from './capabilities.decorator';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId')
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

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
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  setInventory(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.availability.setInventory(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
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
  @Roles(Role.TenantOwner, Role.TenantAdmin)
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
}
