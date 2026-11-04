import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenueDepositRulesService } from './venue-deposit-rules.service';
type Request = { tenantContext: { tenantId: string; userId: string } };
@Controller('tenants/:tenantId/venues/:venueId/deposit-rules')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
export class VenueDepositRulesController {
  constructor(
    @Inject(VenueDepositRulesService) private readonly service: VenueDepositRulesService,
  ) {}
  @Get()
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.view')
  list(@Param('venueId') venueId: string, @Req() req: Request) {
    return this.service.list(req.tenantContext.tenantId, venueId);
  }
  @Post('quote')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  quote(@Param('venueId') venueId: string, @Req() req: Request, @Body() body: unknown) {
    return this.service.quote(req.tenantContext.tenantId, venueId, req.tenantContext.userId, body);
  }
  @Put()
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  save(@Param('venueId') venueId: string, @Req() req: Request, @Body() body: unknown) {
    return this.service.save(req.tenantContext.tenantId, venueId, req.tenantContext.userId, body);
  }
}
