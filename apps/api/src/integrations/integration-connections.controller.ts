import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { IntegrationConnectionsService } from './integration-connections.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string } };

@Controller('tenants/:tenantId')
export class IntegrationConnectionsController {
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
  ) {}

  @Get('integration-setup')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  setup() {
    return this.connections.setup();
  }

  @Get('integration-connections')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  list(@Req() request: TenantRequest) {
    return this.connections.list(request.tenantContext.tenantId);
  }

  @Get('integration-connections/:connectionId/credentials')
  @Header('Cache-Control', 'private, no-store')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  credentialDetails(@Param('connectionId') id: string, @Req() request: TenantRequest) {
    return this.connections.credentialDetails(request.tenantContext.tenantId, id);
  }

  @Post('integration-connections')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  create(@Body() body: unknown, @Req() request: TenantRequest) {
    return this.connections.create(
      request.tenantContext.tenantId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch('integration-connections/:connectionId/credentials')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  replaceCredentials(
    @Param('connectionId') id: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
  ) {
    return this.connections.replaceCredentials(
      request.tenantContext.tenantId,
      request.tenantContext.userId,
      id,
      body,
    );
  }

  @Delete('integration-connections/:connectionId')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  remove(@Param('connectionId') connectionId: string, @Req() request: TenantRequest) {
    return this.connections.delete(
      request.tenantContext.tenantId,
      request.tenantContext.userId,
      connectionId,
    );
  }

  @Post('integration-connections/:connectionId/test')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  test(@Param('connectionId') connectionId: string, @Req() request: TenantRequest) {
    return this.connections.test(
      request.tenantContext.tenantId,
      request.tenantContext.userId,
      connectionId,
    );
  }

  @Get('properties/:propertyId/integration-connections')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  listForProperty(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return this.connections.listForProperty(request.tenantContext.tenantId, propertyId);
  }

  @Patch('properties/:propertyId/integration-connections/:connectionId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  setForProperty(
    @Param('propertyId') propertyId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
  ) {
    const enabled = (body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean.');
    return this.connections.setPropertyConnection(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
      connectionId,
      enabled,
    );
  }
}
