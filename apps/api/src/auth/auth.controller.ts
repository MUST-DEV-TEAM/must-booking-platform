import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { SignupRateLimited } from './signup-rate-limit.decorator';
import { Public } from '../tenancy/tenant-context.decorator';
import {
  PlatformSupportService,
  SUPPORT_COOKIE,
} from '../platform/console/platform-support.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};
type CookieRequest = { headers: { cookie?: string } };

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformSupportService) private readonly support: PlatformSupportService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  @Post('signup') @SignupRateLimited() async signup(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.signup(body);
    response.cookie('must_session', result.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return {
      user: result.user,
      organization: result.organization,
      property: result.property,
    };
  }
  @Post('login') async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.login(body);
    response.cookie('must_session', result.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return { user: result.user };
  }
  @Post('logout') @HttpCode(204) async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    await this.auth.logout(this.cookie(request.headers.cookie, 'must_session'));
    response.clearCookie('must_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  @Post('password-reset/request') @HttpCode(202) async requestReset(@Body() body: unknown) {
    await this.auth.requestPasswordReset(body);
    return { accepted: true };
  }
  @Post('password-reset/confirm') @HttpCode(204) async reset(@Body() body: unknown) {
    await this.auth.resetPassword(body);
  }
  @Post('email-verification/request') @HttpCode(202) async requestVerification(
    @Body() body: unknown,
  ) {
    await this.auth.requestEmailVerification(body);
    return { accepted: true };
  }
  @Post('email-verification/confirm') @HttpCode(204) async verify(@Body() body: unknown) {
    await this.auth.verifyEmail(body);
  }
  @Get('session') async session(@Req() request: CookieRequest) {
    const user = await this.auth.getSessionUser(
      this.cookie(request.headers.cookie, 'must_session'),
    );
    if (user) return { user };
    // No hotel session: a platform support session lets the dashboard load for that one hotel.
    const access = await this.support.resolveAny(
      this.cookie(request.headers.cookie, SUPPORT_COOKIE),
    );
    if (!access) throw new UnauthorizedException('A valid session is required.');
    await this.support.recordCookieRequest(access, '/auth/session');
    return {
      user: {
        id: `support:${access.sessionId}`,
        email: access.accountEmail,
        emailVerified: true,
        isPlatformAdmin: false,
      },
      support: { sessionId: access.sessionId, kind: access.kind, tenantId: access.tenantId },
    };
  }
  @Get('memberships') async memberships(@Req() request: CookieRequest) {
    const memberships = await this.auth.getSessionMemberships(
      this.cookie(request.headers.cookie, 'must_session'),
    );
    if (memberships) return { memberships };
    const access = await this.support.resolveAny(
      this.cookie(request.headers.cookie, SUPPORT_COOKIE),
    );
    if (!access) throw new UnauthorizedException('A valid session is required.');
    await this.support.recordCookieRequest(access, '/auth/memberships');
    const hotel = await this.database.withTenantTransaction(
      { tenantId: access.tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM "organizations" WHERE "id" = ${access.tenantId}::uuid
      `,
    );
    return {
      memberships: [
        { tenantId: access.tenantId, organizationName: hotel[0]?.name ?? 'Hotel', role: 'OWNER' },
      ],
      support: { sessionId: access.sessionId, kind: access.kind },
    };
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
