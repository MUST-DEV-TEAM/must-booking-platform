import { ReportOtbService } from './tenancy/report-otb.service';
import { PricingController } from './tenancy/pricing.controller';
import { PricingService } from './tenancy/pricing.service';
import { PricingWrites } from './tenancy/pricing-writes.service';
import { InventoryStockController } from './tenancy/inventory-stock.controller';
import { InventoryStockService } from './tenancy/inventory-stock.service';
import { InventoryOverviewController } from './tenancy/inventory-overview.controller';
import { InventoryOverviewService } from './tenancy/inventory-overview.service';
import { InventoryBlocksController } from './tenancy/inventory-blocks.controller';
import { InventoryBlocksService } from './tenancy/inventory-blocks.service';
import { InventoryRestrictionsController } from './tenancy/inventory-restrictions.controller';
import { InventoryRestrictionsService } from './tenancy/inventory-restrictions.service';
import { Module, type NestModule, type MiddlewareConsumer } from '@nestjs/common';
import { auditRequestContext } from './tenancy/audit-request-context';
import { ActivityAuditController } from './tenancy/activity-audit.controller';
import { ActivityAuditService } from './tenancy/activity-audit.service';
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
import { PublicRateLimitGuard } from './tenancy/public-rate-limit.guard';
import { PublicRateLimiterService } from './tenancy/public-rate-limiter.service';
import { RolesGuard } from './tenancy/roles.guard';
import { CapabilitiesGuard } from './tenancy/capabilities.guard';
import { CapabilitiesService } from './tenancy/capabilities.service';
import { CapabilitiesController } from './tenancy/capabilities.controller';
import { PropertyRoleTemplatesService } from './tenancy/property-role-templates.service';
import { StaffInviteService } from './tenancy/staff-invite.service';
import { StaffInviteController } from './tenancy/staff-invite.controller';
import { AdminStaffController } from './tenancy/admin-staff.controller';
import { AdminStaffService } from './tenancy/admin-staff.service';
import { StaffAccessService } from './tenancy/staff-access.service';
import { GuestsController } from './tenancy/guests.controller';
import { GuestsService } from './tenancy/guests.service';
import { ReportsController } from './tenancy/reports.controller';
import { ReportsService } from './tenancy/reports.service';
import { ReportDefinitionsService } from './tenancy/report-definitions.service';
import { ReportViewsController } from './tenancy/report-views.controller';
import { ReportViewsService } from './tenancy/report-views.service';
import { DashboardMetricsService } from './tenancy/dashboard-metrics.service';
import { ReportWorkspaceService } from './tenancy/report-workspace.service';
import { OverviewController } from './tenancy/overview.controller';
import { OverviewService } from './tenancy/overview.service';
import { NotificationInboxService } from './tenancy/notification-inbox.service';
import { NotificationRetentionService } from './tenancy/notification-retention.service';
import { NotificationsController } from './tenancy/notifications.controller';
import { NotificationsService } from './tenancy/notifications.service';
import { AuditLogController } from './tenancy/audit-log.controller';
import { AuditLogService } from './tenancy/audit-log.service';
import { MAIL_PROVIDER } from './mail/mail.provider';
import { ResendMailProvider } from './mail/resend-mail.provider';
import { MailDeliveryService } from './mail/mail-delivery.service';
import { AlertEmailService } from './mail/alert-email.service';
import { BookingUpdateNotificationService } from './mail/booking-update-notification.service';
import { ScheduledEmailService } from './mail/scheduled-email.service';
import { ResendWebhookController } from './mail/resend-webhook.controller';
import { ResendWebhookService } from './mail/resend-webhook.service';
import { PaymentNotificationService } from './mail/payment-notification.service';
import { BookingConfirmationNotificationService } from './mail/booking-confirmation-notification.service';
import { BookingCancellationNotificationService } from './mail/booking-cancellation-notification.service';
import { PlanUsageController } from './tenancy/plan-usage.controller';
import { PlanUsageService } from './tenancy/plan-usage.service';
import { PropertiesController } from './tenancy/properties.controller';
import { PropertiesService } from './tenancy/properties.service';
import { CancellationPoliciesController } from './tenancy/cancellation-policies.controller';
import { CancellationPoliciesService } from './tenancy/cancellation-policies.service';
import {
  EmailPreferencesController,
  NotificationSettingsController,
} from './tenancy/notification-settings.controller';
import { NotificationSettingsService } from './tenancy/notification-settings.service';
import {
  EmailActivityController,
  EmailSenderController,
} from './tenancy/email-activity.controller';
import { EmailActivityService } from './tenancy/email-activity.service';
import { ReviewLinksController, ReviewLinksService } from './tenancy/review-links.controller';
import { EmailTemplateVersionsController } from './tenancy/email-template-versions.controller';
import { EmailTemplateVersionsService } from './tenancy/email-template-versions.service';
import {
  EmailConfigurationController,
  EmailConfigurationService,
} from './tenancy/email-configuration.controller';
import {
  EmailSuppressionsController,
  EmailSuppressionsService,
} from './tenancy/email-suppressions.controller';
import { EmailTemplatesController } from './tenancy/email-templates.controller';
import { EmailTemplatesService } from './tenancy/email-templates.service';
import { STORAGE_PROVIDER } from './storage/storage.provider';
import { R2StorageProvider } from './storage/r2-storage.provider';
import { RoomTypesController } from './tenancy/room-types.controller';
import { AccommodationImportController } from './tenancy/accommodation-import.controller';
import { PropertyImageLibraryController } from './tenancy/property-image-library.controller';
import { RoomTypesService } from './tenancy/room-types.service';
import { AccommodationImportService } from './tenancy/accommodation-import.service';
import { RoomCategoriesController } from './tenancy/room-categories.controller';
import { RoomCategoriesService } from './tenancy/room-categories.service';
import { AccommodationsAuditController } from './tenancy/accommodations-audit.controller';
import { RoomsController } from './tenancy/rooms.controller';
import { PropertyRoomsController } from './tenancy/property-rooms.controller';
import { RoomsService } from './tenancy/rooms.service';
import { RatePlansController } from './tenancy/rate-plans.controller';
import { RatePlansService } from './tenancy/rate-plans.service';
import { AmenitiesController } from './tenancy/amenities.controller';
import { AmenitiesService } from './tenancy/amenities.service';
import { AvailabilityController } from './tenancy/availability.controller';
import { AvailabilityService } from './tenancy/availability.service';
import { PublicAvailabilityController } from './tenancy/public-availability.controller';
import { PublicCatalogController } from './tenancy/public-catalog.controller';
import { PublicCatalogService } from './tenancy/public-catalog.service';
import { WordpressPairingController } from './tenancy/wordpress-pairing.controller';
import { WordpressPairingRedeemController } from './tenancy/wordpress-pairing-redeem.controller';
import { WordpressPairingService } from './tenancy/wordpress-pairing.service';
import { BookingStateMachine } from './booking/booking-state-machine';
import { LocalPmsProvider, PMS_PROVIDER } from './booking/local-pms.provider';
import { PmsProviderRegistry } from './booking/pms-provider-registry';
import { QuoteController } from './booking/quote.controller';
import { QuoteService } from './booking/quote.service';
import { BookingController } from './booking/booking.controller';
import { StaffBookingController } from './booking/staff-booking.controller';
import { PublicBookingController } from './booking/public-booking.controller';
import { BookingProjectionService } from './booking/booking-projection.service';
import { CancellationLinkService } from './booking/cancellation-link.service';
import { MultiRoomBookingService } from './booking/multi-room-booking.service';
import { PAYMENT_PROVIDER } from './payments/payment.provider';
import { StripePaymentProvider } from './payments/stripe-payment.provider';
import { PokPayPaymentProvider } from './payments/pokpay-payment.provider';
import { StripeConnectionTester } from './payments/stripe-connection-tester';
import { PokpayConnectionTester } from './payments/pokpay-connection-tester';
import { PaymentProviderRegistry } from './payments/payment-provider-registry';
import { PokPayPaymentService } from './payments/pokpay-payment.service';
import { PokPayWebhookController } from './payments/pokpay-webhook.controller';
import { StripeWebhookController } from './payments/stripe-webhook.controller';
import { StripeWebhookService } from './payments/stripe-webhook.service';
import { PaymentExpiryService } from './payments/payment-expiry.service';
import { PaymentRefundController } from './payments/payment-refund.controller';
import { PaymentRefundService } from './payments/payment-refund.service';
import { PaymentLedgerController } from './payments/payment-ledger.controller';
import { PaymentLedgerService } from './payments/payment-ledger.service';
import { ManualPaymentController } from './payments/manual-payment.controller';
import { ManualPaymentService } from './payments/manual-payment.service';
import { PlatformAdminController } from './platform/platform-admin.controller';
import { PlatformAdminService } from './platform/platform-admin.service';
import { ProviderHealthService } from './platform/provider-health.service';
import { LocalDemoSeedService } from './tenancy/local-demo-seed.service';
import { CredentialCipherService } from './integrations/credential-cipher';
import { ConnectionTestRegistry } from './integrations/connection-tester';
import { IntegrationConnectionsService } from './integrations/integration-connections.service';
import { IntegrationConnectionsController } from './integrations/integration-connections.controller';
import { ManualReviewService } from './integrations/manual-review.service';
import { ClockHttpClient } from './integrations/clock/clock-http-client';
import { ClockRateLimiterService } from './integrations/clock/clock-rate-limiter';
import { ClockCircuitBreakerService } from './integrations/clock/clock-circuit-breaker';
import { ClockConnectionPingService } from './integrations/clock/clock-connection-ping';
import { ClockConnectionTester } from './integrations/clock/clock-connection-tester';
import { ClockPmsProvider } from './integrations/clock/clock-pms.provider';
import { ClockCatalogSyncService } from './integrations/clock/clock-catalog-sync.service';
import { ClockCatalogSyncController } from './integrations/clock/clock-catalog-sync.controller';
import { ClockAvailabilityService } from './integrations/clock/clock-availability.service';
import { ClockPrePaymentAvailability } from './integrations/clock/clock-pre-payment-availability';
import { PrePaymentAvailabilityRegistry } from './booking/pre-payment-availability';
import { ClockRateRankingService } from './integrations/clock/clock-rate-ranking.service';
import {
  ClockRateRankingBatchController,
  ClockRateRankingController,
} from './integrations/clock/clock-rate-ranking.controller';
import { ClockBookingService } from './integrations/clock/clock-booking.service';
import { ClockBookingConsistencyService } from './integrations/clock/clock-booking-consistency.service';
import { ClockBookingHydrationService } from './integrations/clock/clock-booking-hydration.service';
import { ClockFolioHydrationService } from './integrations/clock/clock-folio-hydration.service';
import { ClockPaymentReconciliationService } from './integrations/clock/clock-payment-reconciliation.service';
import { ClockQueueService } from './integrations/clock/clock-queue.service';
import { ClockWorkerService } from './integrations/clock/clock-worker.service';
import { ClockWebhookVerificationService } from './integrations/clock/clock-webhook-verification.service';
import { ClockWebhookService } from './integrations/clock/clock-webhook.service';
import { ClockWebhookHealthService } from './integrations/clock/clock-webhook-health.service';
import { ClockWebhookController } from './integrations/clock/clock-webhook.controller';

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
    GuestsController,
    ReportsController,
    ReportViewsController,
    OverviewController,
    NotificationsController,
    ActivityAuditController,
    AuditLogController,
    PlanUsageController,
    PropertiesController,
    CancellationPoliciesController,
    NotificationSettingsController,
    EmailPreferencesController,
    EmailTemplatesController,
    EmailSuppressionsController,
    EmailConfigurationController,
    EmailTemplateVersionsController,
    EmailActivityController,
    EmailSenderController,
    ReviewLinksController,
    RoomTypesController,
    AccommodationImportController,
    RoomCategoriesController,
    InventoryRestrictionsController,
    InventoryBlocksController,
    InventoryOverviewController,
    InventoryStockController,
    PricingController,
    AccommodationsAuditController,
    PropertyImageLibraryController,
    RoomsController,
    PropertyRoomsController,
    RatePlansController,
    AmenitiesController,
    AvailabilityController,
    CapabilitiesController,
    PublicAvailabilityController,
    PublicCatalogController,
    WordpressPairingController,
    WordpressPairingRedeemController,
    QuoteController,
    BookingController,
    StaffBookingController,
    PublicBookingController,
    StripeWebhookController,
    PokPayWebhookController,
    ResendWebhookController,
    PaymentRefundController,
    PaymentLedgerController,
    ManualPaymentController,
    PlatformAdminController,
    IntegrationConnectionsController,
    ClockCatalogSyncController,
    ClockRateRankingController,
    ClockRateRankingBatchController,
    ClockWebhookController,
  ],
  providers: [
    TenantDatabaseService,
    AuthService,
    EmailVerificationGuard,
    SignupRateLimitGuard,
    SignupRateLimiterService,
    TenantContextGuard,
    PublicTenantScopedGuard,
    PublicRateLimitGuard,
    PublicRateLimiterService,
    RolesGuard,
    CapabilitiesGuard,
    CapabilitiesService,
    PropertyRoleTemplatesService,
    StaffInviteService,
    AdminStaffService,
    StaffAccessService,
    GuestsService,
    ReportsService,
    ReportDefinitionsService,
    ReportWorkspaceService,
    ReportOtbService,
    DashboardMetricsService,
    ReportViewsService,
    OverviewService,
    NotificationsService,
    ActivityAuditService,
    NotificationInboxService,
    NotificationRetentionService,
    AuditLogService,
    PlanUsageService,
    PropertiesService,
    CancellationPoliciesService,
    NotificationSettingsService,
    EmailTemplatesService,
    EmailSuppressionsService,
    EmailConfigurationService,
    EmailTemplateVersionsService,
    EmailActivityService,
    ReviewLinksService,
    RoomTypesService,
    AccommodationImportService,
    RoomCategoriesService,
    InventoryRestrictionsService,
    InventoryBlocksService,
    InventoryOverviewService,
    InventoryStockService,
    PricingService,
    PricingWrites,
    RoomsService,
    RatePlansService,
    AmenitiesService,
    AvailabilityService,
    PublicCatalogService,
    WordpressPairingService,
    BookingStateMachine,
    BookingProjectionService,
    CancellationLinkService,
    MultiRoomBookingService,
    QuoteService,
    LocalPmsProvider,
    { provide: PMS_PROVIDER, useExisting: LocalPmsProvider },
    StripePaymentProvider,
    PokPayPaymentProvider,
    StripeConnectionTester,
    PokpayConnectionTester,
    PaymentProviderRegistry,
    PokPayPaymentService,
    StripeWebhookService,
    PaymentExpiryService,
    PaymentRefundService,
    PaymentLedgerService,
    ManualPaymentService,
    PlatformAdminService,
    ProviderHealthService,
    LocalDemoSeedService,
    CredentialCipherService,
    ConnectionTestRegistry,
    IntegrationConnectionsService,
    { provide: ClockHttpClient, useFactory: () => new ClockHttpClient() },
    ClockRateLimiterService,
    ClockCircuitBreakerService,
    ClockConnectionPingService,
    ClockConnectionTester,
    ClockPmsProvider,
    PmsProviderRegistry,
    ClockCatalogSyncService,
    ClockAvailabilityService,
    ClockPrePaymentAvailability,
    PrePaymentAvailabilityRegistry,
    ClockRateRankingService,
    ClockBookingService,
    ClockBookingConsistencyService,
    ClockBookingHydrationService,
    ClockFolioHydrationService,
    ClockPaymentReconciliationService,
    ClockQueueService,
    ClockWorkerService,
    {
      provide: ClockWebhookVerificationService,
      useFactory: () => new ClockWebhookVerificationService(),
    },
    ClockWebhookService,
    ClockWebhookHealthService,
    ManualReviewService,
    { provide: PAYMENT_PROVIDER, useExisting: StripePaymentProvider },
    R2StorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: R2StorageProvider },
    ResendMailProvider,
    MailDeliveryService,
    ScheduledEmailService,
    AlertEmailService,
    BookingUpdateNotificationService,
    ResendWebhookService,
    PaymentNotificationService,
    BookingConfirmationNotificationService,
    BookingCancellationNotificationService,
    { provide: MAIL_PROVIDER, useExisting: ResendMailProvider },
    { provide: APP_GUARD, useExisting: TenantContextGuard },
    { provide: APP_GUARD, useExisting: PublicTenantScopedGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useExisting: CapabilitiesGuard },
    { provide: APP_GUARD, useExisting: EmailVerificationGuard },
    { provide: APP_GUARD, useExisting: SignupRateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(auditRequestContext).forRoutes('*');
  }
}
