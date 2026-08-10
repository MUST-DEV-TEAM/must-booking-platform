import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { WordpressPairingService } from './wordpress-pairing.service';

@Controller('tenants/:tenantId/properties/:propertyId/wordpress-pairing')
export class WordpressPairingController {
  constructor(@Inject(WordpressPairingService) private readonly pairing: WordpressPairingService) {}

  @Post()
  @HttpCode(201)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  async generate(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    const code = await this.pairing.generate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
    return { code };
  }
}
