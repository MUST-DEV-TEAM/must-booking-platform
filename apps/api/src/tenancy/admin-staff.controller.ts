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
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { AdminStaffService } from './admin-staff.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { PropertyRoleTemplatesService } from './property-role-templates.service';

@Controller('tenants/:tenantId')
export class AdminStaffController {
  constructor(
    @Inject(AdminStaffService) private readonly staff: AdminStaffService,
    @Inject(PropertyRoleTemplatesService)
    private readonly templates: PropertyRoleTemplatesService,
  ) {}

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

  @Get('properties/:propertyId/role-templates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  listRoleTemplates(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.templates.listTemplates(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Post('properties/:propertyId/role-templates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async createRoleTemplate(
    @Body() body: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ): Promise<void> {
    const { name, capabilityKeys } = this.createTemplateInput(body);
    const missing = await this.templates.missingCapabilityKeys(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      capabilityKeys,
    );
    if (missing.length)
      throw new BadRequestException(`Unknown capability key(s): ${missing.join(', ')}.`);
    await this.templates.createCustomTemplate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      name,
      capabilityKeys,
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

  @Delete('properties/:propertyId/staff/:userId/capabilities/:capabilityKey')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async clearCapabilityOverride(
    @Param('userId') userId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ): Promise<void> {
    await this.staff.clearCapabilityOverride(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      userId,
      capabilityKey,
      request.tenantContext.userId,
    );
  }

  private createTemplateInput(body: unknown): { name: string; capabilityKeys: string[] } {
    const value = (body ?? {}) as Record<string, unknown>;
    if (typeof value.name !== 'string' || !value.name.trim())
      throw new BadRequestException('name is required.');
    if (
      !Array.isArray(value.capabilityKeys) ||
      !value.capabilityKeys.every((key) => typeof key === 'string')
    )
      throw new BadRequestException('capabilityKeys must be an array of strings.');
    const capabilityKeys = value.capabilityKeys.map((key) => key.trim());
    if (capabilityKeys.some((key) => !key))
      throw new BadRequestException('capabilityKeys must not contain empty values.');
    if (new Set(capabilityKeys).size !== capabilityKeys.length)
      throw new BadRequestException('capabilityKeys must not contain duplicates.');
    return { name: value.name.trim(), capabilityKeys };
  }
}
