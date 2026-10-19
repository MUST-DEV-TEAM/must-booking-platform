import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { isLifecycleState, type LifecycleState } from './hotel-lifecycle';
import {
  PlatformAudit,
  PlatformCapability,
  PlatformConsole,
  PlatformCtx,
  requireActor,
  type PlatformRequestContext,
} from './platform-console.decorators';
import {
  PlatformHotelsService,
  type HotelDirectoryQuery,
  type HotelMode,
} from './platform-hotels.service';
import { PlatformLifecycleService } from './platform-lifecycle.service';

const SORTS = ['name', 'created', 'lifecycle', 'owner', 'bookings'] as const;

function directoryQuery(query: Record<string, string | undefined>): HotelDirectoryQuery {
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const lifecycle = (query.lifecycle ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(isLifecycleState) as LifecycleState[];
  const sort = SORTS.find((value) => value === query.sort) ?? 'created';
  return {
    search: query.search?.slice(0, 200),
    lifecycle: lifecycle.length ? lifecycle : undefined,
    mode: query.mode === 'CLOCK' || query.mode === 'MUST_SOURCE' ? (query.mode as HotelMode) : undefined,
    sort,
    direction: query.direction === 'asc' ? 'asc' : 'desc',
    page: positive(query.page, 1),
    pageSize: Math.min(positive(query.pageSize, 25), 100),
  };
}

@PlatformConsole()
@Controller('platform-console/hotels')
export class PlatformHotelsController {
  constructor(
    @Inject(PlatformHotelsService) private readonly hotels: PlatformHotelsService,
    @Inject(PlatformLifecycleService) private readonly lifecycle: PlatformLifecycleService,
  ) {}

  @Get()
  @PlatformCapability('platform.hotels.view')
  list(@Query() query: Record<string, string | undefined>) {
    return this.hotels.list(directoryQuery(query));
  }

  @Post()
  @PlatformCapability('platform.hotels.create')
  @PlatformAudit('platform.hotel.created', { targetType: 'organization' })
  create(@Body() body: unknown, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.hotels.create(body, ctx);
  }

  @Get(':id')
  @PlatformCapability('platform.hotels.view')
  get(@Param('id', ParseUUIDPipe) id: string, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.hotels.get(id, requireActor(ctx).capabilities);
  }

  @Get(':id/connections')
  @PlatformCapability('platform.connections.view')
  connections(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotels.connections(id);
  }

  @Get(':id/staff-usage')
  @PlatformCapability('platform.hotels.view')
  staffUsage(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotels.staffUsage(id);
  }

  @Get(':id/onboarding')
  @PlatformCapability('platform.hotels.view')
  onboarding(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotels.onboarding(id);
  }

  @Post(':id/lifecycle')
  @PlatformCapability('platform.hotels.lifecycle')
  @PlatformAudit('platform.hotel.lifecycle_changed', { tenantParam: 'id', targetType: 'organization' })
  changeLifecycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
  ) {
    return this.lifecycle.transition(id, body, ctx);
  }

  @Post(':id/owner-invitations')
  @PlatformCapability('platform.hotels.create')
  @PlatformAudit('platform.hotel.owner_invited', { tenantParam: 'id', targetType: 'organization' })
  inviteOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
  ) {
    return this.hotels.inviteOwner(id, body, ctx);
  }
}
