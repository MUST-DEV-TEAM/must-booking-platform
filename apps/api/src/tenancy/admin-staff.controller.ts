import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { AdminStaffService } from './admin-staff.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';

@Controller('tenants/:tenantId')
export class AdminStaffController {
  constructor(@Inject(AdminStaffService) private readonly staff: AdminStaffService) {}

  @Get('memberships')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  listMemberships(@Req() request: { tenantContext: { tenantId: string } }) {
    return this.staff.listMemberships(request.tenantContext.tenantId);
  }

  @Patch('memberships/:userId')
  @HttpCode(204)
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async changeMembershipRole(
    @Param('userId') userId: string,
    @Body() body: { role?: string },
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<void> {
    await this.staff.changeMembershipRole(
      request.tenantContext.tenantId,
      userId,
      body.role ?? '',
      request.tenantContext.userId,
    );
  }

  @Delete('memberships/:userId')
  @HttpCode(204)
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async removeMembership(
    @Param('userId') userId: string,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<void> {
    await this.staff.removeMembership(
      request.tenantContext.tenantId,
      userId,
      request.tenantContext.userId,
    );
  }

  @Get('properties/:propertyId/staff')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  listPropertyStaff(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.staff.listPropertyStaff(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Put('properties/:propertyId/staff/:userId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async assignPropertyStaff(
    @Param('userId') userId: string,
    @Body() body: { roleTemplateId?: string },
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ): Promise<void> {
    if (!body.roleTemplateId) throw new BadRequestException('roleTemplateId is required.');
    await this.staff.assignPropertyStaff(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      userId,
      body.roleTemplateId,
      request.tenantContext.userId,
    );
  }

  @Put('properties/:propertyId/staff/:userId/capabilities/:capabilityKey')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async setCapabilityOverride(
    @Param('userId') userId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Body() body: { granted?: boolean },
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ): Promise<void> {
    if (typeof body.granted !== 'boolean')
      throw new BadRequestException('granted must be boolean.');
    await this.staff.setCapabilityOverride(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      userId,
      capabilityKey,
      body.granted,
      request.tenantContext.userId,
    );
  }
}
