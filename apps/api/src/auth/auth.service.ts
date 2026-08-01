import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider';

type AuthUserRecord = {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};
type AuthUser = AuthUserRecord & { isPlatformAdmin: boolean };
type Session = { userId: string };
type EmailVerificationToken = { userId: string; email: string; organizationName: string };
type SignupInput = {
  organizationName: string;
  propertyName: string;
  propertyAddress: string;
  propertyTimezone: string;
  email: string;
  password: string;
};
type SignupResult = {
  sessionId: string;
  user: { id: string; email: string; emailVerified: boolean };
  organization: { id: string; name: string };
  property: { id: string; name: string; address: string; timezone: string };
};

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  async signup(input: unknown): Promise<SignupResult> {
    const command = this.signupInput(input);
    const organizationId = randomUUID();
    const propertyId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(command.password, 12);

    try {
      await this.database.withTenantTransaction({ tenantId: organizationId }, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "organizations" ("id", "name")
          VALUES (${organizationId}::uuid, ${command.organizationName})
        `;
        await tx.$executeRaw`
          INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "address", "timezone")
          VALUES (
            ${propertyId}::uuid,
            ${organizationId}::uuid,
            ${command.propertyName},
            ${this.propertySlug(command.propertyName, propertyId)},
            ${command.propertyAddress},
            ${command.propertyTimezone}
          )
        `;
        await tx.$executeRaw`
          INSERT INTO "users" ("id", "email", "password_hash")
          VALUES (${userId}::uuid, ${command.email}, ${passwordHash})
        `;
        await tx.$executeRaw`
          INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
          VALUES (${organizationId}::uuid, ${userId}::uuid, 'OWNER')
        `;
        await this.auditLogs.recordInTransaction(tx, {
          tenantId: organizationId,
          actorUserId: userId,
          action: 'tenant.created',
          targetType: 'organization',
          targetId: organizationId,
        });
        await this.auditLogs.recordInTransaction(tx, {
          tenantId: organizationId,
          propertyId,
          actorUserId: userId,
          action: 'property.created',
          targetType: 'property',
          targetId: propertyId,
        });
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('Email is already registered.');
      throw error;
    }

    const verificationToken = await this.issueEmailVerificationToken({
      userId,
      email: command.email,
      organizationName: command.organizationName,
    });
    await this.sendVerificationEmailSafely({
      userId,
      to: command.email,
      organizationName: command.organizationName,
      verificationToken,
    });
    const sessionId = await this.createSession(userId);
    return {
      sessionId,
      user: { id: userId, email: command.email, emailVerified: false },
      organization: { id: organizationId, name: command.organizationName },
      property: {
        id: propertyId,
        name: command.propertyName,
        address: command.propertyAddress,
        timezone: command.propertyTimezone,
      },
    };
  }

  async login(input: unknown): Promise<{
    sessionId: string;
    user: { id: string; email: string; emailVerified: boolean; isPlatformAdmin: boolean };
  }> {
    const { email, password } = this.credentials(input);
    const user = await this.findUser(email);
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const sessionId = await this.createSession(user.id);
    await this.auditLogs.record({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
    });
    return {
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    const userId = await this.getSessionUserId(sessionId);
    if (sessionId) await this.client().then((redis) => redis.del(`auth:session:${sessionId}`));
    if (userId) {
      await this.auditLogs.record({
        actorUserId: userId,
        action: 'auth.logout',
        targetType: 'user',
        targetId: userId,
      });
    }
  }

  async getSessionUserId(sessionId: string | undefined): Promise<string | null> {
    if (!sessionId) return null;
    const value = await this.client().then((redis) => redis.get(`auth:session:${sessionId}`));
    if (!value) return null;
    try {
      const session = JSON.parse(value) as Session;
      return typeof session.userId === 'string' ? session.userId : null;
    } catch {
      return null;
    }
  }

  async getSessionUser(sessionId: string | undefined): Promise<{
    id: string;
    email: string;
    emailVerified: boolean;
    isPlatformAdmin: boolean;
  } | null> {
    const userId = await this.getSessionUserId(sessionId);
    if (!userId) return null;
    const user = await this.findUserById(userId);
    return user
      ? {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          isPlatformAdmin: user.isPlatformAdmin,
        }
      : null;
  }

  async getSessionMemberships(
    sessionId: string | undefined,
  ): Promise<Array<{ tenantId: string; organizationName: string; role: string }> | null> {
    const userId = await this.getSessionUserId(sessionId);
    if (!userId) return null;
    return this.database.$queryRaw<
      Array<{ tenantId: string; organizationName: string; role: string }>
    >`
      SELECT "tenantId", "organizationName", role FROM "auth_list_user_tenants"(${userId}::uuid)
    `;
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.findUserById(userId);
    return user !== null && user.emailVerifiedAt !== null;
  }

  async requestPasswordReset(input: unknown): Promise<void> {
    const email = this.email(input);
    const user = await this.findUser(email);
    if (user) {
      const resetToken = await this.issueToken('password-reset', user.id, 3_600);
      await this.sendPasswordResetEmailSafely({
        userId: user.id,
        to: user.email,
        resetToken,
      });
    }
  }

  async resetPassword(input: unknown): Promise<void> {
    const { token, password } = this.tokenAndPassword(input);
    const userId = await this.consumeToken('password-reset', token);
    if (!userId) throw new BadRequestException('Invalid or expired password-reset token.');
    await this.database
      .$executeRaw`SELECT "auth_update_password"(${userId}::uuid, ${await bcrypt.hash(password, 12)})`;
  }

  async requestEmailVerification(input: unknown): Promise<void> {
    const user = await this.findUser(this.email(input));
    if (user && !user.emailVerifiedAt) {
      const verificationToken = await this.issueEmailVerificationToken({
        userId: user.id,
        email: user.email,
        organizationName: 'your organization',
      });
      await this.sendVerificationEmailSafely({
        userId: user.id,
        to: user.email,
        organizationName: 'your organization',
        verificationToken,
      });
    }
  }

  async verifyEmail(input: unknown): Promise<void> {
    const token = this.token(input);
    const verification = await this.consumeEmailVerificationToken(token);
    if (!verification)
      throw new BadRequestException('Invalid or expired email-verification token.');
    await this.database
      .$executeRaw`SELECT "auth_mark_email_verified"(${verification.userId}::uuid)`;
    await this.sendWelcomeEmailSafely({
      userId: verification.userId,
      to: verification.email,
      organizationName: verification.organizationName,
    });
  }

  private async findUser(email: string): Promise<AuthUser | null> {
    const rows = await this.database.$queryRaw<AuthUserRecord[]>`
      SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt"
      FROM "auth_get_user_by_email"(${email})
    `;
    return rows[0] ? this.withPlatformRole(rows[0]) : null;
  }

  private async findUserById(userId: string): Promise<AuthUser | null> {
    const rows = await this.database.$queryRaw<AuthUserRecord[]>`
      SELECT id, email, NULL::text AS "passwordHash", email_verified_at AS "emailVerifiedAt"
      FROM "auth_get_user_by_id"(${userId}::uuid)
    `;
    return rows[0] ? this.withPlatformRole(rows[0]) : null;
  }

  private async withPlatformRole(user: AuthUserRecord): Promise<AuthUser> {
    const rows = await this.database.$queryRaw<Array<{ isPlatformAdmin: boolean }>>`
      SELECT "auth_is_platform_admin"(${user.id}::uuid) AS "isPlatformAdmin"
    `;
    return { ...user, isPlatformAdmin: rows[0]?.isPlatformAdmin === true };
  }

  private async issueToken(kind: string, userId: string, ttl: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.set(`auth:${kind}:${this.hash(token)}`, userId, ttl);
    return token;
  }

  private async issueEmailVerificationToken(value: EmailVerificationToken): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.set(`auth:email-verification:${this.hash(token)}`, JSON.stringify(value), 86_400);
    return token;
  }

  private async consumeEmailVerificationToken(
    token: string,
  ): Promise<EmailVerificationToken | null> {
    const value = await this.consumeToken('email-verification', token);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as Partial<EmailVerificationToken>;
      return typeof parsed.userId === 'string' &&
        typeof parsed.email === 'string' &&
        typeof parsed.organizationName === 'string'
        ? { userId: parsed.userId, email: parsed.email, organizationName: parsed.organizationName }
        : null;
    } catch {
      return null;
    }
  }

  private async createSession(userId: string): Promise<string> {
    const sessionId = randomUUID();
    await this.set(
      `auth:session:${sessionId}`,
      JSON.stringify({ userId } satisfies Session),
      604_800,
    );
    return sessionId;
  }

  private async sendVerificationEmailSafely(
    command: Omit<Parameters<MailProvider['sendVerificationEmail']>[0], 'verificationUrl'> & {
      verificationToken: string;
    },
  ) {
    try {
      await this.mail.sendVerificationEmail({
        userId: command.userId,
        to: command.to,
        organizationName: command.organizationName,
        verificationUrl: this.verificationUrl(command.verificationToken),
      });
    } catch (error) {
      this.logMailFailure('verification', command.userId, error);
    }
  }

  private async sendWelcomeEmailSafely(command: Parameters<MailProvider['sendWelcomeEmail']>[0]) {
    try {
      await this.mail.sendWelcomeEmail(command);
    } catch (error) {
      this.logMailFailure('welcome', command.userId, error);
    }
  }

  private async sendPasswordResetEmailSafely(
    command: Omit<Parameters<MailProvider['sendPasswordResetEmail']>[0], 'resetUrl'> & {
      resetToken: string;
    },
  ) {
    try {
      await this.mail.sendPasswordResetEmail({
        userId: command.userId,
        to: command.to,
        resetUrl: this.passwordResetUrl(command.resetToken),
      });
    } catch (error) {
      this.logMailFailure('password-reset', command.userId, error);
    }
  }

  private logMailFailure(
    kind: 'verification' | 'welcome' | 'password-reset',
    userId: string,
    error: unknown,
  ): void {
    this.logger.error(
      `Unable to send ${kind} email for user ${userId}; continuing core action.`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  private passwordResetUrl(token: string): string {
    const baseUrl = process.env.WEB_APP_URL?.trim();
    if (!baseUrl) throw new Error('WEB_APP_URL must be configured before sending email.');
    const url = new URL('/reset-password', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async consumeToken(kind: string, token: string): Promise<string | null> {
    return this.client().then((redis) => redis.getDel(`auth:${kind}:${this.hash(token)}`));
  }

  private async set(key: string, value: string, ttl: number): Promise<void> {
    await this.client().then((redis) => redis.set(key, value, { EX: ttl }));
  }

  private async client(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.connectPromise ??= this.redis.connect();
      await this.connectPromise;
    }
    return this.redis;
  }

  private credentials(input: unknown): { email: string; password: string } {
    const email = this.email(input);
    const password = this.field(input, 'password');
    if (password.length < 12)
      throw new BadRequestException('Password must be at least 12 characters.');
    return { email, password };
  }

  private signupInput(input: unknown): SignupInput {
    const { email, password } = this.credentials(input);
    const organizationName = this.field(input, 'organizationName');
    const propertyName = this.field(input, 'propertyName');
    const propertyAddress = this.field(input, 'propertyAddress');
    const propertyTimezone = this.field(input, 'propertyTimezone');

    if (organizationName.length > 200 || propertyName.length > 200)
      throw new BadRequestException(
        'Organization and property names must be at most 200 characters.',
      );
    if (propertyAddress.length > 500)
      throw new BadRequestException('propertyAddress must be at most 500 characters.');
    if (propertyTimezone.length > 100 || !this.isTimezone(propertyTimezone))
      throw new BadRequestException('propertyTimezone must be a valid IANA timezone.');

    return { organizationName, propertyName, propertyAddress, propertyTimezone, email, password };
  }

  private tokenAndPassword(input: unknown): { token: string; password: string } {
    const token = this.token(input);
    const password = this.field(input, 'password');
    if (password.length < 12)
      throw new BadRequestException('Password must be at least 12 characters.');
    return { token, password };
  }

  private email(input: unknown): string {
    const email = this.field(input, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('A valid email is required.');
    return email;
  }

  private token(input: unknown): string {
    return this.field(input, 'token');
  }
  private field(input: unknown, field: string): string {
    const value =
      typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>)[field]
        : undefined;
    if (typeof value !== 'string' || value.trim() === '')
      throw new BadRequestException(`${field} is required.`);
    return value.trim();
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  private propertySlug(name: string, propertyId: string): string {
    const base = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
    return `${base || 'property'}-${propertyId.slice(0, 8)}`;
  }
  private isTimezone(value: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }
  private verificationUrl(token: string): string {
    const baseUrl = process.env.WEB_APP_URL?.trim();
    if (!baseUrl) throw new Error('WEB_APP_URL must be configured before sending email.');
    const url = new URL('/email-verification', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010'
    );
  }
}
