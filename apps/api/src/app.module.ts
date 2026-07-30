import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

import { validateEnvironment } from './config/environment';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EmailVerificationGuard } from './auth/email-verification.guard';
import { SignupRateLimitGuard } from './auth/signup-rate-limit.guard';
import { SignupRateLimiterService } from './auth/signup-rate-limiter.service';
import { HealthController } from './health/health.controller';
import { TenantDatabaseService } from './tenancy/tenant-database.service';
import { TenantContextGuard } from './tenancy/tenant-context.guard';
import { PublicTenantScopedGuard } from './tenancy/public-tenant-scoped.guard';
import { RolesGuard } from './tenancy/roles.guard';
import { CapabilitiesGuard } from './tenancy/capabilities.guard';
import { PropertyRoleTemplatesService } from './tenancy/property-role-templates.service';
import { StaffInviteService } from './tenancy/staff-invite.service';
import { StaffInviteController } from './tenancy/staff-invite.controller';
import { AdminStaffController } from './tenancy/admin-staff.controller';
import { AdminStaffService } from './tenancy/admin-staff.service';
import { AuditLogController } from './tenancy/audit-log.controller';
import { AuditLogService } from './tenancy/audit-log.service';
import { MAIL_PROVIDER } from './mail/mail.provider';
import { ResendMailProvider } from './mail/resend-mail.provider';
import { PlanUsageController } from './tenancy/plan-usage.controller';
import { PlanUsageService } from './tenancy/plan-usage.service';
import { PropertiesController } from './tenancy/properties.controller';
import { PropertiesService } from './tenancy/properties.service';
import { STORAGE_PROVIDER } from './storage/storage.provider';
import { R2StorageProvider } from './storage/r2-storage.provider';
import { RoomTypesController } from './tenancy/room-types.controller';
import { RoomTypesService } from './tenancy/room-types.service';
import { RoomsController } from './tenancy/rooms.controller';
import { RoomsService } from './tenancy/rooms.service';
import { RatePlansController } from './tenancy/rate-plans.controller';
import { RatePlansService } from './tenancy/rate-plans.service';
import { AmenitiesController } from './tenancy/amenities.controller';
import { AmenitiesService } from './tenancy/amenities.service';
import { AvailabilityController } from './tenancy/availability.controller';
import { AvailabilityService } from './tenancy/availability.service';
import { BookingStateMachine } from './booking/booking-state-machine';
import { LocalPmsProvider, PMS_PROVIDER } from './booking/local-pms.provider';
import { QuoteController } from './booking/quote.controller';
import { QuoteService } from './booking/quote.service';
import { BookingController } from './booking/booking.controller';
import { BookingProjectionService } from './booking/booking-projection.service';

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
    PlanUsageController,
    PropertiesController,
    RoomTypesController,
    RoomsController,
    RatePlansController,
    AmenitiesController,
    AvailabilityController,
    QuoteController,
    BookingController,
  ],
  providers: [
    TenantDatabaseService,
    AuthService,
    EmailVerificationGuard,
    SignupRateLimitGuard,
    SignupRateLimiterService,
    TenantContextGuard,
    PublicTenantScopedGuard,
    RolesGuard,
    CapabilitiesGuard,
    PropertyRoleTemplatesService,
    StaffInviteService,
    AdminStaffService,
    AuditLogService,
    PlanUsageService,
    PropertiesService,
    RoomTypesService,
    RoomsService,
    RatePlansService,
    AmenitiesService,
    AvailabilityService,
    BookingStateMachine,
    BookingProjectionService,
    QuoteService,
    LocalPmsProvider,
    { provide: PMS_PROVIDER, useExisting: LocalPmsProvider },
    R2StorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: R2StorageProvider },
    ResendMailProvider,
    { provide: MAIL_PROVIDER, useExisting: ResendMailProvider },
    { provide: APP_GUARD, useExisting: TenantContextGuard },
    { provide: APP_GUARD, useExisting: PublicTenantScopedGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useExisting: CapabilitiesGuard },
    { provide: APP_GUARD, useExisting: EmailVerificationGuard },
    { provide: APP_GUARD, useExisting: SignupRateLimitGuard },
  ],
})
export class AppModule {}
