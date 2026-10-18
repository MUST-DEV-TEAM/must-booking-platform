import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { ReportsService } from './reports.service';
import { ReportDefinitionsService } from './report-definitions.service';
import { CapabilitiesService } from './capabilities.service';
import { ReportWorkspaceService } from './report-workspace.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/reports')
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportDefinitionsService) private readonly definitions: ReportDefinitionsService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(ReportWorkspaceService) private readonly workspace: ReportWorkspaceService,
  ) {}

  @Get('workspace')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('reports.view')
  getWorkspace(
    @Query() query: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    return this.workspace.workspace(request.tenantContext, query);
  }

  @Post('exports')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('reports.view')
  export(
    @Body() body: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    return this.workspace.export(request.tenantContext, body);
  }

  @Get('definitions')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('reports.view')
  async getDefinitions(
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const context = request.tenantContext;
    const capabilities = await this.capabilities.effective(context);
    return this.definitions.get(
      context.tenantId,
      context.propertyId,
      capabilities.includes('payments.view'),
    );
  }

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('reports.view')
  async get(
    @Query() query: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const report = await this.reports.get(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
    const grants = await this.capabilities.effective(request.tenantContext);
    return grants.includes('payments.view') ? report : { ...report, revenue: [] };
  }
}
