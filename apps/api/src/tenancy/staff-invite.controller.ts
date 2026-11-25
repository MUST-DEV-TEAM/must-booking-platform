import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';

import { Public } from './tenant-context.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { StaffInviteService, type StaffInvite } from './staff-invite.service';
import { TenantScoped } from './tenant-context.decorator';
import { AuthService } from '../auth/auth.service';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';

@Controller()
export class StaffInviteController {
  constructor(
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post('tenants/:tenantId/staff-invitations')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.create')
  @RequiresVerifiedEmail()
  async invite(
    @Body() body: Omit<StaffInvite, 'tenantId'>,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<{ token: string }> {
    return {
      token: await this.invites.invite(
        // membershipRole is never accepted from a hotel user: only the platform console may invite an owner.
        {
          email: body.email,
          assignments: body.assignments,
          tenantId: request.tenantContext.tenantId,
        },
        request.tenantContext.userId,
      ),
    };
  }

  @Get('tenants/:tenantId/staff-invitations')
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.view')
  list(@Req() request: { tenantContext: { tenantId: string } }) {
    return this.invites.list(request.tenantContext.tenantId);
  }

  @Post('tenants/:tenantId/staff-invitations/:invitationId/resend')
  @HttpCode(204)
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.create')
  @RequiresVerifiedEmail()
  async resend(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<void> {
    await this.invites.resend(
      request.tenantContext.tenantId,
      invitationId,
      request.tenantContext.userId,
    );
  }

  @Delete('tenants/:tenantId/staff-invitations/:invitationId')
  @HttpCode(204)
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.create')
  @RequiresVerifiedEmail()
  async withdraw(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ): Promise<void> {
    await this.invites.withdraw(
      request.tenantContext.tenantId,
      invitationId,
      request.tenantContext.userId,
    );
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
