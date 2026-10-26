import { PaymentCollectionService } from './payment-collection.service';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Money } from '@must/domain-contracts';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { LocalPmsProvider } from '../booking/local-pms.provider';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { type PaymentEvidence, ManualPaymentService } from './manual-payment.service';
import { PokPayPaymentService } from './pokpay-payment.service';

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class ManualPaymentController {
  constructor(
    @Inject(ManualPaymentService) private readonly payments: ManualPaymentService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(PokPayPaymentService) private readonly pokpay: PokPayPaymentService,
    @Inject(PaymentCollectionService) private readonly collections: PaymentCollectionService,
  ) {}

  @Get(':bookingId/collection-options')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.record')
  options(
    @Param('bookingId') id: string,
    @Req() req: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.collections.options(req.tenantContext, id);
  }

  @Post(':bookingId/collect-pokpay')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.record')
  @RequiresVerifiedEmail()
  collect(
    @Param('bookingId') id: string,
    @Req() req: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
    @Headers('idempotency-key') key?: string,
  ) {
    return this.collections.start(
      req.tenantContext,
      id,
      req.tenantContext.userId,
      this.idempotencyKey(key),
    );
  }

  @Post(':bookingId/check-collection')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.record')
  checkCollection(
    @Param('bookingId') id: string,
    @Body() body: { orderId?: unknown },
    @Req() req: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    if (body?.orderId !== undefined && typeof body.orderId !== 'string')
      throw new BadRequestException('Choose a valid payment attempt.');
    return this.collections.refresh(req.tenantContext, id, body?.orderId as string | undefined);
  }

  @Post(':bookingId/send-pokpay-link')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.record')
  @RequiresVerifiedEmail()
  sendCollectionLink(
    @Param('bookingId') id: string,
    @Req() req: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
    @Headers('idempotency-key') key?: string,
  ) {
    return this.collections.sendLink(
      req.tenantContext,
      id,
      req.tenantContext.userId,
      this.idempotencyKey(key),
    );
  }

  @Post(':bookingId/check-payment')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  async checkPayment(
    @Param('bookingId') bookingId: string,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    await this.pokpay.refreshBooking(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      bookingId,
    );
    return { ok: true };
  }

  @Post(':bookingId/resend-pokpay-checkout')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  async resendPokPayCheckout(
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const result = await this.bookings.resendPokPayCheckout(request.tenantContext, {
      bookingId,
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      actorUserId: request.tenantContext.userId,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }

  @Post(':bookingId/manual-payment')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.record')
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
      note: this.note(value.note),
      evidence: this.evidence(value.evidence),
      actorUserId: request.tenantContext.userId,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }

  private evidence(value: unknown): PaymentEvidence | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Invalid payment evidence.');
    const v = value as Record<string, unknown>;
    if (typeof v.receivedOn !== 'string')
      throw new BadRequestException('Enter the date payment was received.');
    for (const key of ['reference', 'payerName', 'terminalId'])
      if (v[key] !== undefined && (typeof v[key] !== 'string' || (v[key] as string).length > 120))
        throw new BadRequestException('Payment references must be at most 120 characters.');
    return {
      receivedOn: v.receivedOn,
      reference: (v.reference as string | undefined)?.trim(),
      payerName: (v.payerName as string | undefined)?.trim(),
      terminalId: (v.terminalId as string | undefined)?.trim(),
    };
  }
  private note(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > 500)
      throw new BadRequestException('Use a payment reference or note of up to 500 characters.');
    return value.trim();
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
