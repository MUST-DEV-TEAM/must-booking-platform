import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from './tenant-context.decorator';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import {
  PUBLIC_BOOKING_MUTATION_RATE_LIMIT,
  PUBLIC_QUOTE_RATE_LIMIT,
  PUBLIC_READ_RATE_LIMIT,
  PublicRateLimit,
} from './public-rate-limit.decorator';
import { PublicRestaurantService } from './public-restaurant.service';

@Public()
@UseGuards(PublicRateLimitGuard)
@Controller('v1/tenants/:tenantId/restaurants/:venueId')
export class PublicRestaurantController {
  constructor(
    @Inject(PublicRestaurantService) private readonly restaurants: PublicRestaurantService,
  ) {}
  @Get()
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  info(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
  ) {
    return this.restaurants.info(tenantId, venueId);
  }
  @Get('layout')
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  layout(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
  ) {
    return this.restaurants.layout(tenantId, venueId);
  }
  @Get('availability')
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  availability(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.restaurants.availability(tenantId, venueId, query);
  }
  @Post('quote')
  @PublicRateLimit(PUBLIC_QUOTE_RATE_LIMIT)
  quote(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() body: unknown,
  ) {
    return this.restaurants.quote(tenantId, venueId, body);
  }
  @Post('reservations')
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() body: unknown,
  ) {
    return this.restaurants.create(tenantId, venueId, body);
  }
  @Get('reservations/:reservationId')
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  status(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.restaurants.status(tenantId, venueId, reservationId, authorization);
  }
}
