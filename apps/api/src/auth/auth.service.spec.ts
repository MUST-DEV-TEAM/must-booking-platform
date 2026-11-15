import * as bcrypt from 'bcrypt';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

// An in-memory stand-in for the Redis client, with only what AuthService uses. TTLs are not
// simulated; expirations are recorded so the tests can check they were requested.
class FakeRedis {
  isOpen = true;
  readonly store = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly expirations = new Map<string, number>();
  failScan = false;

  connect = async () => this;
  quit = async () => undefined;
  get = async (key: string) => this.store.get(key) ?? null;
  set = async (key: string, value: string) => {
    this.store.set(key, value);
    return 'OK';
  };
  getDel = async (key: string) => {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return value;
  };
  del = async (key: string) => {
    const existed = this.store.delete(key) || this.sets.delete(key);
    return existed ? 1 : 0;
  };
  sAdd = async (key: string, member: string) => {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
    return 1;
  };
  sRem = async (key: string, member: string) => (this.sets.get(key)?.delete(member) ? 1 : 0);
  sMembers = async (key: string) => [...(this.sets.get(key) ?? [])];
  expire = async (key: string, seconds: number) => {
    this.expirations.set(key, seconds);
    return 1;
  };
  ttl = async () => 60;
  eval = async () => [1];
  scan = async (_cursor: string, options: { MATCH: string }) => {
    if (this.failScan) throw new Error('redis unavailable');
    const prefix = options.MATCH.replace('*', '');
    return { cursor: '0', keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)) };
  };
}

const fakeRedis = new FakeRedis();
vi.mock('redis', () => ({ createClient: () => fakeRedis }));

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'guest@example.test' };
const OLD_PASSWORD = 'old-correct-horse-battery';
const NEW_PASSWORD = 'new-correct-horse-battery';

describe('AuthService session revocation on password change', () => {
  let passwordHash: string;
  let service: AuthService;
  let audit: { record: ReturnType<typeof vi.fn>; recordAccountEventInTransaction: unknown };
  let resetUrls: string[];

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(OLD_PASSWORD, 4);
  });

  beforeEach(() => {
    process.env.WEB_APP_URL = 'https://app.example.test';
    fakeRedis.store.clear();
    fakeRedis.sets.clear();
    fakeRedis.expirations.clear();
    fakeRedis.failScan = false;
    resetUrls = [];
    audit = { record: vi.fn(), recordAccountEventInTransaction: vi.fn() };
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('auth_is_platform_admin')) return [{ isPlatformAdmin: false }];
        if (sql.includes('auth_user_tenant_states')) return [];
        return [{ ...USER, passwordHash, emailVerifiedAt: new Date() }];
      },
      $transaction: async (callback: (tx: unknown) => Promise<void>) =>
        callback({ $executeRaw: vi.fn() }),
    };
    const delivery = {
      dispatch: async (_kind: string, payload: { resetUrl: string }) => {
        resetUrls.push(payload.resetUrl);
      },
    };
    service = new AuthService(database as never, audit as never, {} as never, delivery as never);
  });

  const signIn = async () =>
    (await service.login({ email: USER.email, password: OLD_PASSWORD })).sessionId;
  const requestReset = async () => {
    await service.triggerPasswordReset(USER);
    return new URL(resetUrls.at(-1) as string).searchParams.get('token') as string;
  };

  it('ends every session when the password is reset by token', async () => {
    const a = await signIn();
    const b = await signIn();
    const token = await requestReset();

    await service.resetPassword({ token, password: NEW_PASSWORD });

    expect(await service.getSessionUserId(a)).toBeNull();
    expect(await service.getSessionUserId(b)).toBeNull();
  });

  it('keeps the current session and ends the others when the password is changed', async () => {
    const a = await signIn();
    const b = await signIn();

    await service.changePassword(a, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });

    expect(await service.getSessionUserId(a)).toBe(USER.id);
    expect(await service.getSessionUserId(b)).toBeNull();
    expect(fakeRedis.sets.get(`auth:user-sessions:${USER.id}`)).toEqual(new Set([a]));
  });

  it('stops an unused reset token when the password is changed while signed in', async () => {
    const session = await signIn();
    const token = await requestReset();

    await service.changePassword(session, {
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    await expect(service.resetPassword({ token, password: OLD_PASSWORD })).rejects.toThrow(
      'Invalid or expired password-reset token.',
    );
  });

  it('stops the other unused reset tokens once one is used', async () => {
    const first = await requestReset();
    const second = await requestReset();

    await service.resetPassword({ token: first, password: NEW_PASSWORD });

    await expect(service.resetPassword({ token: second, password: NEW_PASSWORD })).rejects.toThrow(
      'Invalid or expired password-reset token.',
    );
  });

  it('also ends a session created before the index existed', async () => {
    const indexed = await signIn();
    const legacy = 'legacy-session-without-index';
    fakeRedis.store.set(`auth:session:${legacy}`, JSON.stringify({ userId: USER.id }));
    const other = 'someone-elses-session';
    fakeRedis.store.set(`auth:session:${other}`, JSON.stringify({ userId: 'another-user' }));
    const token = await requestReset();

    await service.resetPassword({ token, password: NEW_PASSWORD });

    expect(await service.getSessionUserId(indexed)).toBeNull();
    expect(await service.getSessionUserId(legacy)).toBeNull();
    expect(await service.getSessionUserId(other)).toBe('another-user');
  });

  it('records how many sessions were ended', async () => {
    await signIn();
    await signIn();
    fakeRedis.store.set('auth:session:legacy', JSON.stringify({ userId: USER.id }));
    const token = await requestReset();

    await service.resetPassword({ token, password: NEW_PASSWORD });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: USER.id,
        action: 'auth.sessions_revoked',
        details: { reason: 'Password reset', count: 3 },
      }),
    );
  });

  it('records the count for a change, not counting the kept session', async () => {
    const a = await signIn();
    await signIn();

    await service.changePassword(a, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.sessions_revoked',
        details: { reason: 'Password changed', count: 1 },
      }),
    );
  });

  it('indexes sessions and reset tokens with an expiry, and sign-out removes the id', async () => {
    const a = await signIn();
    await requestReset();
    expect(fakeRedis.expirations.get(`auth:user-sessions:${USER.id}`)).toBe(604_800);
    expect(fakeRedis.expirations.get(`auth:user-reset-tokens:${USER.id}`)).toBe(3_600);

    await service.logout(a);

    expect(fakeRedis.sets.get(`auth:user-sessions:${USER.id}`)?.has(a)).toBe(false);
  });

  it('still completes the password reset when revoking sessions fails', async () => {
    const a = await signIn();
    const token = await requestReset();
    fakeRedis.failScan = true;

    await expect(service.resetPassword({ token, password: NEW_PASSWORD })).resolves.toBeUndefined();

    expect(await service.getSessionUserId(a)).toBe(USER.id);
  });
});
