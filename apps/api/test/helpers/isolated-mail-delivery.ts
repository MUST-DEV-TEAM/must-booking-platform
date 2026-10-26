import { randomUUID } from 'node:crypto';
import { MAIL_PROVIDER, type MailProvider } from '../../src/mail/mail.provider';
import { MailDeliveryService } from '../../src/mail/mail-delivery.service';
import { TenantDatabaseService } from '../../src/tenancy/tenant-database.service';
/** Real Redis delivery with an isolated worker, so the dev API cannot consume a test message. */
export const isolatedMailDelivery = {
  inject: [TenantDatabaseService, MAIL_PROVIDER],
  factory(database: TenantDatabaseService, provider: MailProvider) {
    const delivery = new MailDeliveryService(database, provider);
    delivery.queueName = `mail-test-${randomUUID()}`;
    return delivery;
  },
};
