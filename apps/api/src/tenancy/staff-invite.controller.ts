import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { Public } from './tenant-context.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { StaffInviteService, type StaffInvite } from './staff-invite.service';
import { TenantScoped } from './tenant-context.decorator';
import { AuthService } from '../auth/auth.service';

@Controller()
export class StaffInviteController {
  constructor(
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post('tenants/:tenantId/staff-invitations')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.invite')
  async invite(
    @Body() body: Omit<StaffInvite, 'tenantId'>,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<{ token: string }> {
    return {
      token: await this.invites.invite(
        { ...body, tenantId: request.tenantContext.tenantId },
        request.tenantContext.userId,
      ),
    };
  }

  @Public()
  @Post('auth/staff-invitations/activate')
  @HttpCode(204)
  async activate(
    @Body() body: { token?: string; email?: string; password?: string },
  ): Promise<void> {
    await this.invites.activate(body.token ?? '', body.email ?? '', body.password ?? '');
  }

  @Public()
  @Post('auth/staff-invitations/accept')
  @HttpCode(204)
  async acceptExisting(
    @Body() body: { token?: string },
    @Req() request: { headers: { cookie?: string } },
  ): Promise<void> {
    const sessionId = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === 'must_session')?.[1];
    const userId = await this.auth.getSessionUserId(sessionId);
    if (!userId) throw new BadRequestException('A valid session is required.');
    await this.invites.accept(body.token ?? '', userId);
  }
}
