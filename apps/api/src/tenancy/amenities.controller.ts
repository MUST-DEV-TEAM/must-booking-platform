import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
import { AmenitiesService } from './amenities.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId')
export class AmenitiesController {
  constructor(@Inject(AmenitiesService) private readonly amenities: AmenitiesService) {}

  @Get('amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: TenantPropertyRequest) {
    return this.amenities.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post('amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.amenities.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete('amenities/:amenityId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  remove(
    @Param('amenityId') amenityId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.amenities.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      amenityId,
      request.tenantContext.userId,
    );
  }

  @Get('room-types/:roomTypeId/amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  listRoomTypeAmenities(
    @Param('roomTypeId') roomTypeId: string,
    @Req() request: TenantPropertyRequest,
  ) {
    return this.amenities.listRoomTypeAmenities(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
    );
  }

  @Put('room-types/:roomTypeId/amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  setRoomTypeAmenities(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.amenities.setRoomTypeAmenities(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Get('rooms/:roomId/amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  listRoomAmenities(@Param('roomId') roomId: string, @Req() request: TenantPropertyRequest) {
    return this.amenities.listRoomAmenities(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
    );
  }

  @Put('rooms/:roomId/amenities')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  setRoomAmenities(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.amenities.setRoomAmenities(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }
}
