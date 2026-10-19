import type { TestingModuleBuilder } from '@nestjs/testing';
import { ClockWorkerService } from '../../src/integrations/clock/clock-worker.service';
import { ClockWebhookHealthService } from '../../src/integrations/clock/clock-webhook-health.service';
import { ProviderHealthService } from '../../src/platform/provider-health.service';
import { PaymentExpiryService } from '../../src/payments/payment-expiry.service';
/** Email HTTP tests must never consume shared provider/payment jobs from the dev environment. */
export function withoutExternalWorkers(builder: TestingModuleBuilder): TestingModuleBuilder {
  for (const provider of [
    ClockWorkerService,
    ClockWebhookHealthService,
    ProviderHealthService,
    PaymentExpiryService,
  ])
    builder.overrideProvider(provider).useValue({});
  return builder;
}
