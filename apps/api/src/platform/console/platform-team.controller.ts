import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import {
  PlatformAudit,
  PlatformCapability,
  PlatformConsole,
  PlatformCtx,
  type PlatformRequestContext,
} from './platform-console.decorators';
import { PlatformTeamService } from './platform-team.service';

@PlatformConsole()
@Controller('platform-console/team')
export class PlatformTeamController {
  constructor(@Inject(PlatformTeamService) private readonly team: PlatformTeamService) {}

  @Get()
  @PlatformCapability('platform.team.view')
  async list() {
    return { members: await this.team.list() };
  }

  @Get('roles')
  @PlatformCapability('platform.team.view')
  roles() {
    return this.team.roles();
  }

  @Post('invitations')
  @PlatformCapability('platform.team.manage')
  @PlatformAudit('platform.team.invited', { targetType: 'platform_account' })
  invite(@Body() body: unknown, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.team.invite(body, ctx);
  }

  @Post()
  @PlatformCapability('platform.team.manage')
  @PlatformAudit('platform.team.created', { targetType: 'platform_account' })
  create(@Body() body: unknown, @PlatformCtx() ctx: PlatformRequestContext) {
    return this.team.create(body, ctx);
  }

  @Patch(':id/role')
  @PlatformCapability('platform.team.manage')
  @PlatformAudit('platform.team.role_changed', { targetType: 'platform_account' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
  ) {
    ctx.hint.targetId = id;
    return this.team.changeRole(id, body, ctx);
  }

  @Patch(':id/status')
  @PlatformCapability('platform.team.manage')
  @PlatformAudit('platform.team.status_changed', { targetType: 'platform_account' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @PlatformCtx() ctx: PlatformRequestContext,
  ) {
    ctx.hint.targetId = id;
    return this.team.setStatus(id, body, ctx);
  }
}
