import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';

import { PlatformAuthService, toMe } from './platform-auth.service';
import {
  PlatformAudit,
  PlatformAuthenticated,
  PlatformConsole,
  PlatformCtx,
  PlatformNoIdempotency,
  PlatformPublic,
  requireActor,
  type PlatformRequestContext,
} from './platform-console.decorators';
import { PLATFORM_COOKIE, platformCookieOptions } from './platform-session.service';

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};

@PlatformConsole()
@Controller('platform-console/auth')
export class PlatformAuthController {
  constructor(@Inject(PlatformAuthService) private readonly auth: PlatformAuthService) {}

  @Post('login')
  @PlatformPublic()
  @PlatformNoIdempotency()
  @PlatformAudit('platform.auth.login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const { token, me } = await this.auth.login(body, ctx);
    response.cookie(PLATFORM_COOKIE, token, platformCookieOptions());
    return { me };
  }

  @Post('invitations/accept')
  @PlatformPublic()
  @PlatformNoIdempotency()
  @PlatformAudit('platform.team.invitation_accepted')
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const { token, me } = await this.auth.acceptInvitation(body, ctx);
    response.cookie(PLATFORM_COOKIE, token, platformCookieOptions());
    return { me };
  }

  @Post('logout')
  @PlatformAuthenticated()
  @PlatformNoIdempotency()
  @PlatformAudit('platform.auth.logout')
  @HttpCode(204)
  async logout(
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    await this.auth.logout(ctx);
    response.clearCookie(PLATFORM_COOKIE, { ...platformCookieOptions(), maxAge: undefined });
  }

  @Post('logout-everywhere')
  @PlatformAuthenticated()
  @PlatformNoIdempotency()
  @PlatformAudit('platform.auth.logout_everywhere')
  async logoutEverywhere(
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.logoutEverywhere(ctx);
    response.clearCookie(PLATFORM_COOKIE, { ...platformCookieOptions(), maxAge: undefined });
    return result;
  }

  @Get('me')
  @PlatformAuthenticated()
  me(@PlatformCtx() ctx: PlatformRequestContext) {
    return { me: toMe(requireActor(ctx)) };
  }
}
