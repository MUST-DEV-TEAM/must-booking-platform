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
  Req,
} from '@nestjs/common';

import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { RoomTypesService } from './room-types.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/room-types')
export class RoomTypesController {
  constructor(@Inject(RoomTypesService) private readonly roomTypes: RoomTypesService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: TenantPropertyRequest) {
    return this.roomTypes.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch(':roomTypeId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  update(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':roomTypeId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  remove(
    @Param('roomTypeId') roomTypeId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
    );
  }

  @Get(':roomTypeId/images')
  @TenantScoped({ propertyParam: 'propertyId' })
  listImages(@Param('roomTypeId') roomTypeId: string, @Req() request: TenantPropertyRequest) {
    return this.roomTypes.listImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
    );
  }

  @Post(':roomTypeId/images')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  createImageUpload(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.createImageUpload(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }
}
