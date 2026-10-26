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

import { TenantScoped } from './tenant-context.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
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

  @Get(':roomId/images')
  @TenantScoped({ propertyParam: 'propertyId' })
  listImages(@Param('roomId') roomId: string, @Req() request: TenantPropertyRequest) {
    return this.rooms.listImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
    );
  }

  @Post(':roomId/images')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  createImageUpload(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.createImageUpload(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post(':roomId/images/from-url')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  createImageFromUrl(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.createImageFromUrl(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post(':roomId/images/from-library')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  attachLibraryImages(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.attachLibraryImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Put(':roomId/images/order')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  reorderImages(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.reorderImages(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Put(':roomId/images/primary')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  setPrimaryImage(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.setPrimaryImage(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':roomId/images/:imageId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  removeImage(
    @Param('roomId') roomId: string,
    @Param('imageId') imageId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.removeImage(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      imageId,
      request.tenantContext.userId,
    );
  }
}
