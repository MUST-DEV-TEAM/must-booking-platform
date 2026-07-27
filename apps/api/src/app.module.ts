import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

import { validateEnvironment } from './config/environment';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { HealthController } from './health/health.controller';
import { TenantDatabaseService } from './tenancy/tenant-database.service';
import { TenantContextGuard } from './tenancy/tenant-context.guard';
import { RolesGuard } from './tenancy/roles.guard';
import { CapabilitiesGuard } from './tenancy/capabilities.guard';
import { PropertyRoleTemplatesService } from './tenancy/property-role-templates.service';
import { StaffInviteService } from './tenancy/staff-invite.service';
import { StaffInviteController } from './tenancy/staff-invite.controller';
import { AdminStaffController } from './tenancy/admin-staff.controller';
import { AdminStaffService } from './tenancy/admin-staff.service';
import { AuditLogController } from './tenancy/audit-log.controller';
import { AuditLogService } from './tenancy/audit-log.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        customAttributeKeys: {
          req: 'request',
          res: 'response',
          responseTime: 'duration',
        },
        genReqId: (request) => {
          const requestId = request.headers['x-request-id'];

          return typeof requestId === 'string' && requestId.trim() !== ''
            ? requestId
            : randomUUID();
        },
        serializers: {
          req: (request: IncomingMessage & { id?: string }) => ({
            id: request.id,
            method: request.method,
            path: request.url,
          }),
          res: (response: ServerResponse) => ({
            statusCode: response.statusCode,
          }),
        },
      },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    StaffInviteController,
    AdminStaffController,
    AuditLogController,
  ],
  providers: [
    TenantDatabaseService,
    AuthService,
    TenantContextGuard,
    RolesGuard,
    CapabilitiesGuard,
    PropertyRoleTemplatesService,
    StaffInviteService,
    AdminStaffService,
    AuditLogService,
    { provide: APP_GUARD, useExisting: TenantContextGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useExisting: CapabilitiesGuard },
  ],
})
export class AppModule {}
