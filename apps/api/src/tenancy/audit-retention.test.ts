import { expect, it } from 'vitest';
import { NotificationRetentionService } from './notification-retention.service';
import type { TenantDatabaseService } from './tenant-database.service';
import type { NotificationInboxService } from './notification-inbox.service';
import type { EmailMessageArchiveService } from '../mail/email-message-archive.service';
import type { EmailActivityService } from './email-activity.service';
import type { ActivityAuditService } from './activity-audit.service';
it('nightly discovery passes the same exact property to inbox and temporary-file cleanup on retries', async () => {
  const scope = { tenantId: 'tenant', propertyId: 'property' },
    calls: unknown[] = [];
  const db = {
    async $queryRaw() {
      return [scope];
    },
  } as unknown as TenantDatabaseService;
  const inbox = {
    async cleanup(c: unknown) {
      calls.push(['inbox', c]);
    },
  } as unknown as NotificationInboxService;
  const audit = {
    async cleanupExports(c: unknown) {
      calls.push(['exports', c]);
    },
  } as unknown as ActivityAuditService;
  const email = {
    async cleanupExports(c: unknown) {
      calls.push(['email-exports', c]);
    },
  } as unknown as EmailActivityService;
  const previews = {
    async cleanup(c: unknown) {
      calls.push(['previews', c]);
    },
  } as unknown as EmailMessageArchiveService;
  const worker = new NotificationRetentionService(db, inbox, audit, email, previews);
  await worker.sweep();
  await worker.sweep();
  expect(calls).toEqual([
    ['inbox', scope],
    ['exports', scope],
    ['email-exports', scope],
    ['previews', scope],
    ['inbox', scope],
    ['exports', scope],
    ['email-exports', scope],
    ['previews', scope],
  ]);
});
