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
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
import { RoomCategoriesService } from './room-categories.service';

type PropertyRequest = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/room-categories')
export class RoomCategoriesController {
  constructor(@Inject(RoomCategoriesService) private readonly categories: RoomCategoriesService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: PropertyRequest) {
    return this.categories.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  create(@Body() body: unknown, @Req() request: PropertyRequest) {
    return this.categories.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch(':categoryId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  update(
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
    @Req() request: PropertyRequest,
  ) {
    return this.categories.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      categoryId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':categoryId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  remove(@Param('categoryId') categoryId: string, @Req() request: PropertyRequest) {
    return this.categories.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      categoryId,
      request.tenantContext.userId,
    );
  }

  @Put('order')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  reorder(@Body() body: unknown, @Req() request: PropertyRequest) {
    return this.categories.reorder(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }
}
