import { expect, it } from 'vitest';
import { auditRequestContext, currentAuditContext } from './audit-request-context';
it('keeps concurrent request references separate and captures only minimal route context', async () => {
  const run = (id: string) =>
    new Promise((resolve) => {
      const req = {
        id,
        method: 'POST',
        headers: {
          cookie: 'private-session',
          'user-agent': 'private-device',
          'x-forwarded-for': '192.0.2.1',
        },
        route: { path: '/auth/login' },
        url: '/auth/login?token=private',
      };
      auditRequestContext(req, { setHeader() {} }, () => {
        setTimeout(() => resolve(currentAuditContext()), 5);
      });
    });
  const values = await Promise.all([run('request-a'), run('request-b')]);
  expect(values).toEqual([
    { requestId: 'request-a', method: 'POST', route: '/auth/login' },
    { requestId: 'request-b', method: 'POST', route: '/auth/login' },
  ]);
  expect(currentAuditContext()).toBeNull();
});
