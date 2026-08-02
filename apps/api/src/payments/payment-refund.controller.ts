import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Money } from '@must/domain-contracts';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { PaymentRefundService } from './payment-refund.service';

@Controller('tenants/:tenantId/properties/:propertyId/payments')
export class PaymentRefundController {
  constructor(@Inject(PaymentRefundService) private readonly refunds: PaymentRefundService) {}

  @Post('refunds')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.refund')
  @RequiresVerifiedEmail()
  async refund(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    const result = await this.refunds.manualRefund(request.tenantContext, {
      bookingId: typeof value.bookingId === 'string' ? value.bookingId : '',
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      amount: this.money(value.amount),
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
      throw new BadRequestException('Invalid refund amount.');
    const money = value as Record<string, unknown>;
    if (typeof money.amount !== 'string' || typeof money.currency !== 'string')
      throw new BadRequestException('Invalid refund amount.');
    return { amount: money.amount, currency: money.currency };
  }
}
