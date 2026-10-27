import { Body, Controller, Get, Header, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';

import {
  PublicRateLimit,
  PUBLIC_BOOKING_MUTATION_RATE_LIMIT,
} from '../tenancy/public-rate-limit.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { GuestReviewService } from './guest-review.service';

type Scope = { tenantId: string; propertyId: string };

/** The guest's private review page. The link in the email is the only credential. */
@Controller('tenants/:tenantId/properties/:propertyId/reviews')
@UseGuards(PublicRateLimitGuard)
export class GuestReviewController {
  constructor(@Inject(GuestReviewService) private readonly reviews: GuestReviewService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  form(@Req() req: { tenantContext: Scope }, @Query('token') token?: string) {
    return this.reviews.form(req.tenantContext, token);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  submit(
    @Req() req: { tenantContext: Scope },
    @Query('token') token: string | undefined,
    @Body() body: unknown,
  ) {
    return this.reviews.submit(req.tenantContext, token, body);
  }
}
