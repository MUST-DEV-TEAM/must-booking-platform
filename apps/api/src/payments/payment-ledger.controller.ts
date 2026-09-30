import { Controller, Get, Inject, NotFoundException, Param, Req } from '@nestjs/common';

import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { PaymentLedgerService } from './payment-ledger.service';

@Controller('tenants/:tenantId/properties/:propertyId/payments')
export class PaymentLedgerController {
  constructor(@Inject(PaymentLedgerService) private readonly ledgers: PaymentLedgerService) {}

  // Same audience as the Payments page itself: whoever may refund may read the ledger.
  @Get('bookings/:bookingId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('payments.refund')
  async ledger(
    @Param('bookingId') bookingId: string,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    const ledger = await this.ledgers.ledger(request.tenantContext, bookingId);
    if (!ledger) throw new NotFoundException('Booking was not found.');
    return ledger;
  }
}
