import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { RoomTypesService } from './room-types.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/image-library')
export class PropertyImageLibraryController {
  constructor(@Inject(RoomTypesService) private readonly roomTypes: RoomTypesService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  list(@Req() request: TenantPropertyRequest) {
    return this.roomTypes.listLibrary(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  createUpload(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.createLibraryUpload(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post(':imageId/confirm')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  confirm(@Param('imageId') imageId: string, @Req() request: TenantPropertyRequest) {
    return this.roomTypes.confirmLibraryUpload(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      imageId,
    );
  }

  @Delete(':imageId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  remove(
    @Param('imageId') imageId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.removeLibraryImage(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      imageId,
      request.tenantContext.userId,
    );
  }
}
