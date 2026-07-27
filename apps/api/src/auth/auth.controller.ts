import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';

import { AuthService } from './auth.service';
import { Public } from '../tenancy/tenant-context.decorator';

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};
type CookieRequest = { headers: { cookie?: string } };

@Public()
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('signup') async signup(@Body() body: unknown) {
    return this.auth.signup(body);
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

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
