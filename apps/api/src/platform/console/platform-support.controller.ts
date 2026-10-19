import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';

import {
  PlatformAudit,
  PlatformAuthenticated,
  PlatformCapability,
  PlatformConsole,
  PlatformCtx,
  PlatformNoIdempotency,
  type PlatformRequestContext,
} from './platform-console.decorators';
import { PlatformSupportService, SUPPORT_COOKIE } from './platform-support.service';

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
};

export function supportCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}

@PlatformConsole()
@Controller('platform-console/support-sessions')
export class PlatformSupportController {
  constructor(@Inject(PlatformSupportService) private readonly support: PlatformSupportService) {}

  /** Own sessions, plus other people's pending act-as requests for approvers. */
  @Get()
  @PlatformAuthenticated()
  async list(@PlatformCtx() ctx: PlatformRequestContext, @Query('tenantId') tenantId?: string) {
    return {
      sessions: await this.support.list(
        ctx,
        tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : undefined,
      ),
    };
  }

  /** View-as needs platform.support.view_as; act-as needs platform.support.act_as (checked inside). */
  @Post()
  @PlatformAuthenticated()
  @PlatformAudit('platform.support.requested', { targetType: 'support_session' })
  create(@Body() body: unknown, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.support.create(body, ctx);
  }

  @Post(':id/approve')
  @PlatformCapability('platform.support.approve')
  @PlatformAudit('platform.support.act_approved', { targetType: 'support_session' })
  approve(@Param('id', ParseUUIDPipe) id: string, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.support.approve(id, ctx);
  }

  @Post(':id/deny')
  @PlatformCapability('platform.support.approve')
  @PlatformAudit('platform.support.act_denied', { targetType: 'support_session' })
  deny(@Param('id', ParseUUIDPipe) id: string, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.support.deny(id, ctx);
  }

  @Post(':id/revoke')
  @PlatformAuthenticated()
  @PlatformAudit('platform.support.revoked', { targetType: 'support_session' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.support.revoke(id, ctx);
  }

  /** Opens the hotel dashboard for the caller's own active session by setting the support cookie. */
  @Post(':id/enter')
  @PlatformAuthenticated()
  @PlatformNoIdempotency()
  @PlatformAudit('platform.support.entered', { targetType: 'support_session' })
  @HttpCode(200)
  async enter(
    @Param('id', ParseUUIDPipe) id: string,
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const { session, token } = await this.support.enter(id, ctx);
    response.cookie(SUPPORT_COOKIE, token, supportCookieOptions(session.expiresAt));
    return { session, dashboardPath: `/dashboard/${session.tenantId}` };
  }
}
