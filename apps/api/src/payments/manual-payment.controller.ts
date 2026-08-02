import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Money } from '@must/domain-contracts';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { ManualPaymentService } from './manual-payment.service';

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class ManualPaymentController {
  constructor(@Inject(ManualPaymentService) private readonly payments: ManualPaymentService) {}

  @Post(':bookingId/manual-payment')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.manage')
  @RequiresVerifiedEmail()
  async record(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    const result = await this.payments.record(request.tenantContext, {
      bookingId,
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      amount: this.money(value.amount),
      method: this.method(value.method),
      actorUserId: request.tenantContext.userId,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value?.trim()) throw new BadRequestException('Idempotency-Key header is required.');
    return value;
  }

  private money(value: unknown): Money | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object')
      throw new BadRequestException('Invalid payment amount.');
    const money = value as Record<string, unknown>;
    if (typeof money.amount !== 'string' || typeof money.currency !== 'string')
      throw new BadRequestException('Invalid payment amount.');
    return { amount: money.amount, currency: money.currency };
  }

  private method(value: unknown): 'cash' | 'card_in_person' | 'bank_transfer' {
    if (value === 'cash' || value === 'card_in_person' || value === 'bank_transfer') return value;
    throw new BadRequestException('method must be cash, card_in_person, or bank_transfer.');
  }
}
