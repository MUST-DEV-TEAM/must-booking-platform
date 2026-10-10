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

import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
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
  @RequiresCapability('photos.manage')
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

  @Post(':roomTypeId/images/from-url')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  createImageFromUrl(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.createImageFromUrl(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post(':roomTypeId/images/from-library')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  attachLibraryImages(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.attachLibraryImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Put(':roomTypeId/images/order')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  reorderImages(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.reorderImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Put(':roomTypeId/images/primary')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  setPrimaryImage(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.setPrimaryImage(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':roomTypeId/images/:imageId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  removeImage(
    @Param('roomTypeId') roomTypeId: string,
    @Param('imageId') imageId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.roomTypes.removeImage(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      imageId,
      request.tenantContext.userId,
    );
  }
}
