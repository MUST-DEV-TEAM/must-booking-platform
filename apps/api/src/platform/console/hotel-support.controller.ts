import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';

import { Public, TenantScoped } from '../../tenancy/tenant-context.decorator';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { readCookie } from './platform-access.guard';
import { PlatformSupportService, SUPPORT_COOKIE } from './platform-support.service';

type OwnerRequest = { tenantContext: { tenantId: string; userId: string } };

/**
 * Hotel-side support endpoints. The banner and "end session" calls authenticate with the support
 * cookie itself; the Owner routes use the normal hotel session and are refused inside any support
 * session (they declare no capability, so a support context can never reach them).
 */
@Controller()
export class HotelSupportController {
  constructor(
    @Inject(PlatformSupportService) private readonly support: PlatformSupportService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  @Public()
  @Get('support/current')
  async current(@Req() request: { headers: { cookie?: string } }) {
    return this.support.currentForBanner(readCookie(request.headers.cookie, SUPPORT_COOKIE));
  }

  @Public()
  @Post('support/end')
  @HttpCode(204)
  async end(
    @Req() request: { headers: { cookie?: string } },
    @Res({ passthrough: true })
    response: { clearCookie(name: string, options: Record<string, unknown>): void },
  ) {
    await this.support.endByCookie(readCookie(request.headers.cookie, SUPPORT_COOKIE));
    response.clearCookie(SUPPORT_COOKIE, { httpOnly: true, sameSite: 'strict', path: '/' });
  }

  @Get('tenants/:tenantId/support-sessions')
  @TenantScoped()
  @Roles(Role.TenantOwner)
  async list(@Req() request: OwnerRequest) {
    return { sessions: await this.support.listForHotel(request.tenantContext.tenantId) };
  }

  @Post('tenants/:tenantId/support-sessions/:id/approve')
  @TenantScoped()
  @Roles(Role.TenantOwner)
  approve(@Param('id', ParseUUIDPipe) id: string, @Req() request: OwnerRequest) {
    return this.decide(request, id, 'approve');
  }

  @Post('tenants/:tenantId/support-sessions/:id/deny')
  @TenantScoped()
  @Roles(Role.TenantOwner)
  deny(@Param('id', ParseUUIDPipe) id: string, @Req() request: OwnerRequest) {
    return this.decide(request, id, 'deny');
  }

  @Post('tenants/:tenantId/support-sessions/:id/revoke')
  @TenantScoped()
  @Roles(Role.TenantOwner)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() request: OwnerRequest) {
    return this.decide(request, id, 'revoke');
  }

  private async decide(request: OwnerRequest, id: string, decision: 'approve' | 'deny' | 'revoke') {
    const { tenantId, userId } = request.tenantContext;
    const email = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ email: string }>>`
        SELECT "email" FROM "users" WHERE "id" = ${userId}::uuid
      `;
      return rows[0]?.email ?? 'owner';
    });
    return this.support.ownerDecide(tenantId, id, userId, email, decision);
  }
}
