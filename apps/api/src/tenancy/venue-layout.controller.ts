import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenueLayoutService } from './venue-layout.service';

type LayoutRequest = { tenantContext: { tenantId: string; userId: string } };

@Controller('tenants/:tenantId/venues/:venueId')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
export class VenueLayoutController {
  constructor(@Inject(VenueLayoutService) private readonly layout: VenueLayoutService) {}

  @Get('layout')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.view')
  get(@Param('venueId') venueId: string, @Req() request: LayoutRequest) {
    return this.layout.get(request.tenantContext.tenantId, venueId);
  }

  @Post('areas')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  createArea(
    @Param('venueId') venueId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.createArea(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch('areas/:areaId')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  updateArea(
    @Param('venueId') venueId: string,
    @Param('areaId') areaId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.updateArea(
      request.tenantContext.tenantId,
      venueId,
      areaId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete('areas/:areaId')
  @HttpCode(204)
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  deleteArea(
    @Param('venueId') venueId: string,
    @Param('areaId') areaId: string,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.deleteArea(
      request.tenantContext.tenantId,
      venueId,
      areaId,
      request.tenantContext.userId,
    );
  }

  @Post('areas/:areaId/tables')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  createTable(
    @Param('venueId') venueId: string,
    @Param('areaId') areaId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.createTable(
      request.tenantContext.tenantId,
      venueId,
      areaId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch('tables/:tableId')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  updateTable(
    @Param('venueId') venueId: string,
    @Param('tableId') tableId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.updateTable(
      request.tenantContext.tenantId,
      venueId,
      tableId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete('tables/:tableId')
  @HttpCode(204)
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  deleteTable(
    @Param('venueId') venueId: string,
    @Param('tableId') tableId: string,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.deleteTable(
      request.tenantContext.tenantId,
      venueId,
      tableId,
      request.tenantContext.userId,
    );
  }

  @Put('layout/positions')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  savePositions(
    @Param('venueId') venueId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.savePositions(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
      body,
    );
  }

  @Put('tables/:tableId/combinable')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  setCombinable(
    @Param('venueId') venueId: string,
    @Param('tableId') tableId: string,
    @Body() body: unknown,
    @Req() request: LayoutRequest,
  ) {
    return this.layout.setCombinable(
      request.tenantContext.tenantId,
      venueId,
      tableId,
      request.tenantContext.userId,
      body,
    );
  }
}
