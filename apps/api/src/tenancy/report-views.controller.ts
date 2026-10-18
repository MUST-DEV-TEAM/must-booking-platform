import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ReportViewsService } from './report-views.service';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/reports/views')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
@RequiresCapability('reports.view')
export class ReportViewsController {
  constructor(@Inject(ReportViewsService) private readonly views: ReportViewsService) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() r: Request) {
    return this.views.list(r.tenantContext);
  }
  @Get(':id/workspace')
  @TenantScoped({ propertyParam: 'propertyId' })
  execute(@Req() r: Request, @Param('id') id: string) {
    return this.views.execute(r.tenantContext, id);
  }
  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  create(
    @Req() r: Request,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.views.change(r.tenantContext, key, 'create', undefined, body);
  }
  @Patch(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  update(
    @Req() r: Request,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.views.change(r.tenantContext, key, 'update', id, body);
  }
  @Delete(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  remove(
    @Req() r: Request,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.views.change(r.tenantContext, key, 'delete', id, body);
  }
  @Post(':id/duplicate')
  @TenantScoped({ propertyParam: 'propertyId' })
  duplicate(
    @Req() r: Request,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.views.change(r.tenantContext, key, 'duplicate', id, body);
  }
}
