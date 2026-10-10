import { Body, Controller, Get, Inject, Injectable, Put, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import {
  REVIEW_SITES,
  parseReviewLinks,
  storedReviewLinks,
  type ReviewLinks,
} from '../mail/review-links';
import { AuditLogService } from './audit-log.service';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type Context = { tenantId: string; propertyId: string };
type RequestContext = { tenantContext: Context & { userId: string } };

export type ReviewLinksView = {
  links: ReviewLinks;
  sites: Array<{ key: string; label: string }>;
};

/** Where guests can review the property, shown in the post-stay thank-you (Step 6). */
@Injectable()
export class ReviewLinksService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  get(context: Context): Promise<ReviewLinksView> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ reviewLinks: unknown }>>`
        SELECT review_links AS "reviewLinks" FROM properties
        WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
      `;
      return this.view(storedReviewLinks(rows[0]?.reviewLinks));
    });
  }

  update(context: Context, actorUserId: string, body: unknown): Promise<ReviewLinksView> {
    const links = parseReviewLinks(body);
    return this.database.withTenantTransaction(context, async (tx) => {
      await tx.$executeRaw`
        UPDATE properties SET review_links = ${JSON.stringify(links)}::jsonb, updated_at = now()
        WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId,
        action: 'review_links.updated',
        targetType: 'property',
        targetId: context.propertyId,
        details: { sites: Object.keys(links) },
      });
      return this.view(links);
    });
  }

  private view(links: ReviewLinks): ReviewLinksView {
    return { links, sites: REVIEW_SITES.map(({ key, label }) => ({ key, label })) };
  }
}

@Controller('tenants/:tenantId/properties/:propertyId/review-links')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class ReviewLinksController {
  constructor(@Inject(ReviewLinksService) private readonly reviewLinks: ReviewLinksService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() request: RequestContext) {
    const { tenantId, propertyId } = request.tenantContext;
    return this.reviewLinks.get({ tenantId, propertyId });
  }

  @Put()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  update(@Body() body: unknown, @Req() request: RequestContext) {
    const { tenantId, propertyId, userId } = request.tenantContext;
    return this.reviewLinks.update({ tenantId, propertyId }, userId, body);
  }
}
