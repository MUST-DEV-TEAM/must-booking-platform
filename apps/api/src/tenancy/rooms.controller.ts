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
import { RoomsService } from './rooms.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/room-types/:roomTypeId/rooms')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Param('roomTypeId') roomTypeId: string, @Req() request: TenantPropertyRequest) {
    return this.rooms.list(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
    );
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomTypeId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch(':roomId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  update(
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':roomId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  remove(
    @Param('roomId') roomId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.rooms.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roomId,
      request.tenantContext.userId,
    );
  }
}
