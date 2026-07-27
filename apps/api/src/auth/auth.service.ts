import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { AuditLogService } from '../tenancy/audit-log.service';

type AuthUser = {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};
type Session = { userId: string };

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  async signup(input: unknown): Promise<{ id: string; email: string }> {
    const { email, password } = this.credentials(input);
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await this.database.$executeRaw`
        INSERT INTO "users" ("id", "email", "password_hash")
        VALUES (${id}::uuid, ${email}, ${passwordHash})
      `;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException('Email is already registered.');
      throw error;
    }

    await this.issueToken('email-verification', id, 86_400);
    return { id, email };
  }

  async login(
    input: unknown,
  ): Promise<{ sessionId: string; user: { id: string; email: string; emailVerified: boolean } }> {
    const { email, password } = this.credentials(input);
    const user = await this.findUser(email);
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const sessionId = randomUUID();
    await this.set(
      `auth:session:${sessionId}`,
      JSON.stringify({ userId: user.id } satisfies Session),
      604_800,
    );
    await this.auditLogs.record({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
    });
    return {
      sessionId,
      user: { id: user.id, email: user.email, emailVerified: user.emailVerifiedAt !== null },
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

  async requestPasswordReset(input: unknown): Promise<void> {
    const email = this.email(input);
    const user = await this.findUser(email);
    if (user) await this.issueToken('password-reset', user.id, 3_600);
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
    if (user && !user.emailVerifiedAt) await this.issueToken('email-verification', user.id, 86_400);
  }

  async verifyEmail(input: unknown): Promise<void> {
    const token = this.token(input);
    const userId = await this.consumeToken('email-verification', token);
    if (!userId) throw new BadRequestException('Invalid or expired email-verification token.');
    await this.database.$executeRaw`SELECT "auth_mark_email_verified"(${userId}::uuid)`;
  }

  private async findUser(email: string): Promise<AuthUser | null> {
    const rows = await this.database.$queryRaw<AuthUser[]>`
      SELECT id, email, password_hash AS "passwordHash", email_verified_at AS "emailVerifiedAt"
      FROM "auth_get_user_by_email"(${email})
    `;
    return rows[0] ?? null;
  }

  private async issueToken(kind: string, userId: string, ttl: number): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.set(`auth:${kind}:${this.hash(token)}`, userId, ttl);
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
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010'
    );
  }
}
