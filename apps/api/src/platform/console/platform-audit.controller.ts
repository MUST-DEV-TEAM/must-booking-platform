import { Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';

import {
  parseAuditFilters,
  platformAuditCsv,
  PlatformAuditService,
} from './platform-audit.service';
import {
  PlatformAudit,
  PlatformCapability,
  PlatformConsole,
  PlatformCtx,
  PlatformNoIdempotency,
  type PlatformRequestContext,
} from './platform-console.decorators';

@PlatformConsole()
@Controller('platform-console/audit')
export class PlatformAuditController {
  constructor(@Inject(PlatformAuditService) private readonly audit: PlatformAuditService) {}

  @Get()
  @PlatformCapability('platform.audit.view')
  search(@Query() query: Record<string, string | undefined>) {
    return this.audit.search(parseAuditFilters(query));
  }

  /** Formula-safe CSV of the rows matching the filters; the export itself is audited. */
  @Post('export')
  @PlatformCapability('platform.audit.export')
  @PlatformNoIdempotency()
  @PlatformAudit('platform.audit.exported')
  async export(
    @Body() body: Record<string, string | undefined>,
    @PlatformCtx() ctx: PlatformRequestContext,
    @Res({ passthrough: true })
    response: { setHeader(name: string, value: string): void },
  ) {
    const filters = parseAuditFilters(body ?? {});
    const rows = await this.audit.exportRows(filters);
    ctx.hint.details = {
      rows: rows.length,
      filters: { ...filters, page: undefined, pageSize: undefined },
    };
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="platform-audit.csv"');
    return platformAuditCsv(rows);
  }
}
