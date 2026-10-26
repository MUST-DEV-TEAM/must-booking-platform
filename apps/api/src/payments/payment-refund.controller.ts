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
import { REFUND_REASONS, type RefundReason, type Money } from '@must/domain-contracts';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { PaymentRefundService } from './payment-refund.service';

@Controller('tenants/:tenantId/properties/:propertyId/payments')
export class PaymentRefundController {
  constructor(
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

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
    const bookingId = typeof value.bookingId === 'string' ? value.bookingId : '';
    // A cancelled reservation is refundable from Payments for 24 hours. After that only people with the
    // "Refund after 24 hours" permission (owners, admins and managers) may do it, and only on purpose.
    const late =
      bookingId !== '' && (await this.refunds.refundWindowClosed(request.tenantContext, bookingId));
    if (late) {
      const allowed = (await this.capabilities.effective(request.tenantContext)).includes(
        'payments.refund_late',
      );
      if (!allowed)
        return {
          ok: false,
          error: {
            code: 'REFUND_WINDOW_CLOSED',
            message:
              'This reservation was cancelled more than 24 hours ago. Only an owner, admin or manager can refund it now.',
            retryable: false,
            lateAllowed: false,
          },
        };
      if (value.lateRefund !== true)
        return {
          ok: false,
          error: {
            code: 'REFUND_WINDOW_CLOSED',
            message:
              'This reservation was cancelled more than 24 hours ago. Confirm that you want to refund it anyway.',
            retryable: false,
            lateAllowed: true,
          },
        };
    }
    const result = await this.refunds.manualRefund(request.tenantContext, {
      bookingId: typeof value.bookingId === 'string' ? value.bookingId : '',
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      amount: this.money(value.amount),
      percentage: this.percentage(value.percentage),
      note: this.lateNote(this.note(value.note), late),
      ...(value.reasonCode === undefined ? {} : { reasonCode: this.reason(value.reasonCode) }),
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

  private percentage(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new BadRequestException('percentage must be a number between 1 and 100.');
    return value;
  }

  private reason(value: unknown): RefundReason {
    if (typeof value !== 'string' || !REFUND_REASONS.includes(value as RefundReason))
      throw new BadRequestException('Choose a valid refund reason.');
    return value as RefundReason;
  }

  /** A refund after the window says so in its note, so the record shows it was a deliberate exception. */
  private lateNote(note: string | undefined, late: boolean): string | undefined {
    if (!late) return note;
    const prefix = 'Refund after the 24-hour window.';
    return note ? `${prefix} ${note}`.slice(0, 500) : prefix;
  }

  private note(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > 500)
      throw new BadRequestException('note must be 500 characters or fewer.');
    const note = value.trim();
    return note || undefined;
  }
}
