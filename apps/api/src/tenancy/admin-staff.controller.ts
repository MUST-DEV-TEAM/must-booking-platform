import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
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
import { CapabilitiesService } from './capabilities.service';
import { StaffAccessService, type RoleInput } from './staff-access.service';
import { CAPABILITY_CATALOG } from './capability-catalog';
import { StaffInviteService } from './staff-invite.service';

@Controller('tenants/:tenantId')
export class AdminStaffController {
  constructor(
    @Inject(AdminStaffService) private readonly staff: AdminStaffService,
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
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
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.view')
  listPropertyStaff(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.staff.listPropertyStaff(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Post('properties/:propertyId/staff')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.create')
  @RequiresVerifiedEmail()
  async createStaff(@Body() body: unknown, @Req() request: ActorRequest): Promise<{ userId: string }> {
    const value = (body ?? {}) as Record<string, unknown>;
    const text = (field: string): string => (typeof value[field] === 'string' ? (value[field] as string) : '');
    const list = (field: string): string[] =>
      Array.isArray(value[field]) ? (value[field] as string[]) : value[field] === undefined ? [] : (value[field] as never);
    const actor = await this.actorCapabilities(request);
    return this.access.createStaff(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      actor,
      {
        firstName: text('firstName'),
        lastName: text('lastName') || undefined,
        email: text('email'),
        password: typeof value.password === 'string' ? value.password : '',
        roleTemplateId: text('roleTemplateId'),
        extraCapabilities: list('extraCapabilities'),
        deniedCapabilities: list('deniedCapabilities'),
      },
    );
  }

  @Post('properties/:propertyId/staff-invitations')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.create')
  @RequiresVerifiedEmail()
  async invitePropertyStaff(
    @Body() body: unknown,
    @Req() request: ActorRequest,
  ): Promise<{ token: string }> {
    const value = (body ?? {}) as Record<string, unknown>;
    const email = value.email;
    const roleTemplateId = value.roleTemplateId;
    if (typeof email !== 'string' || !email.trim())
      throw new BadRequestException('email is required.');
    if (typeof roleTemplateId !== 'string' || !roleTemplateId.trim())
      throw new BadRequestException('roleTemplateId is required.');
    if (value.capabilityKeys !== undefined && !Array.isArray(value.capabilityKeys))
      throw new BadRequestException('capabilityKeys must be an array.');
    const capabilityKeys = (value.capabilityKeys ?? []) as unknown[];
    if (capabilityKeys.some((key) => typeof key !== 'string'))
      throw new BadRequestException('capabilityKeys must contain permission keys.');

    const keys = capabilityKeys as string[];
    const knownKeys = new Set(CAPABILITY_CATALOG.map((entry) => entry.key));
    const unknownKey = keys.find((key) => !knownKeys.has(key));
    if (unknownKey) throw new BadRequestException(`Unknown permission key: ${unknownKey}.`);

    const { tenantId, propertyId, userId } = request.tenantContext;
    const actorCapabilities = await this.actorCapabilities(request);
    const role = (await this.access.listRoles(tenantId, propertyId)).find(
      (entry) => entry.id === roleTemplateId,
    );
    if (!role) throw new NotFoundException('Role not found.');
    this.access.assertCanGrant(actorCapabilities, [...role.capabilities, ...keys]);

    const token = await this.invites.invite(
      {
        tenantId,
        email,
        assignments: [{ propertyId, roleTemplateId: role.id, capabilityKeys: keys }],
      },
      userId,
    );
    return { token };
  }

  @Patch('properties/:propertyId/staff/:userId/status')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.suspend')
  @RequiresVerifiedEmail()
  async setStatus(
    @Param('userId') userId: string,
    @Body() body: { status?: unknown },
    @Req() request: ActorRequest,
  ): Promise<void> {
    await this.access.setStatus(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      userId,
      body.status,
      request.tenantContext.userId,
      await this.actorCapabilities(request),
    );
  }

  @Get('properties/:propertyId/staff/:userId/effective-capabilities')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.view')
  effectiveCapabilities(@Param('userId') userId: string, @Req() request: ActorRequest) {
    return this.access.effectiveCapabilities(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      userId,
    );
  }

  @Get('properties/:propertyId/role-templates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.view')
  listRoleTemplates(@Req() request: ActorRequest) {
    return this.access.listRoles(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post('properties/:propertyId/role-templates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_roles')
  @RequiresVerifiedEmail()
  async createRoleTemplate(@Body() body: unknown, @Req() request: ActorRequest) {
    return this.access.createRole(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      await this.actorCapabilities(request),
      this.roleInput(body),
    );
  }

  @Put('properties/:propertyId/role-templates/:roleId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_roles')
  @RequiresVerifiedEmail()
  async updateRoleTemplate(
    @Param('roleId') roleId: string,
    @Body() body: unknown,
    @Req() request: ActorRequest,
  ) {
    return this.access.updateRole(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roleId,
      request.tenantContext.userId,
      await this.actorCapabilities(request),
      this.roleInput(body),
    );
  }

  @Delete('properties/:propertyId/role-templates/:roleId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_roles')
  @RequiresVerifiedEmail()
  async deleteRoleTemplate(@Param('roleId') roleId: string, @Req() request: ActorRequest): Promise<void> {
    await this.access.deleteRole(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      roleId,
      request.tenantContext.userId,
      await this.actorCapabilities(request),
    );
  }

  @Put('properties/:propertyId/staff/:userId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async assignPropertyStaff(
    @Param('userId') userId: string,
    @Body() body: { roleTemplateId?: string },
    @Req() request: ActorRequest,
  ): Promise<void> {
    if (!body.roleTemplateId) throw new BadRequestException('roleTemplateId is required.');
    const actor = await this.actorCapabilities(request);
    const { tenantId, propertyId } = request.tenantContext;
    const role = (await this.access.listRoles(tenantId, propertyId)).find((entry) => entry.id === body.roleTemplateId);
    if (!role) throw new NotFoundException('Role not found.');
    await this.access.assertCanManageTarget(tenantId, propertyId, userId, actor, role.capabilities);
    await this.staff.assignPropertyStaff(
      tenantId,
      propertyId,
      userId,
      body.roleTemplateId,
      request.tenantContext.userId,
    );
  }

  @Put('properties/:propertyId/staff/:userId/capabilities/:capabilityKey')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async setCapabilityOverride(
    @Param('userId') userId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Body() body: { granted?: boolean },
    @Req() request: ActorRequest,
  ): Promise<void> {
    if (typeof body.granted !== 'boolean')
      throw new BadRequestException('granted must be boolean.');
    const actor = await this.actorCapabilities(request);
    const { tenantId, propertyId } = request.tenantContext;
    await this.access.assertCanManageTarget(tenantId, propertyId, userId, actor, body.granted ? [capabilityKey] : []);
    await this.staff.setCapabilityOverride(
      tenantId,
      propertyId,
      userId,
      capabilityKey,
      body.granted,
      request.tenantContext.userId,
    );
  }

  @Delete('properties/:propertyId/staff/:userId/capabilities/:capabilityKey')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.manage_permissions')
  @RequiresVerifiedEmail()
  async clearCapabilityOverride(
    @Param('userId') userId: string,
    @Param('capabilityKey') capabilityKey: string,
    @Req() request: ActorRequest,
  ): Promise<void> {
    const actor = await this.actorCapabilities(request);
    const { tenantId, propertyId } = request.tenantContext;
    await this.access.assertCanManageTarget(tenantId, propertyId, userId, actor);
    await this.staff.clearCapabilityOverride(
      tenantId,
      propertyId,
      userId,
      capabilityKey,
      request.tenantContext.userId,
    );
  }

  private async actorCapabilities(request: ActorRequest): Promise<ReadonlySet<string>> {
    return new Set(await this.capabilities.effective(request.tenantContext));
  }

  private roleInput(body: unknown): RoleInput {
    const value = (body ?? {}) as Record<string, unknown>;
    return {
      name: value.name as string | undefined,
      description: value.description as string | null | undefined,
      capabilities: value.capabilities as string[] | undefined,
      copyFromId: typeof value.copyFromId === 'string' ? value.copyFromId : undefined,
    };
  }
}

type ActorRequest = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
