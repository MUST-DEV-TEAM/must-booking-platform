# Legacy single-tenant audit

## Scope

Static audit of the imported legacy plugin at upstream commit
`fa62907e86e6ede85a82372642802399648eb544`, performed for Milestone 6, Task 2.
This is an inventory, not an implementation plan: no runtime code was changed and no
provider or WordPress requests were made.  “Local” below means the WordPress install
and its `$wpdb` tables; it is consequently one hotel/property per install.

ADR-0016's kickoff refinement is the target boundary: the retained widget may know
only the MUST API base URL plus tenant/property identifiers, and must use the
anonymous `must_guest_session`.  It must not retain a WordPress-held backend API
credential, payment credential, or PMS credential.

## 1. Hotel/property identity and local tenancy assumption

| File(s) and symbol(s) | Current single-tenant assumption / required rethink |
| --- | --- |
| `src/Core/MustBookingConfig.php` — `OPTION_NAME`, `storage()`, `get_hotel_name()`, `get_hotel_address()`, `get_hotel_phone()`, `get_currency()`, `get_timezone()`, `get_*booking*()` | All hotel identity, locale, currency, tax, deposit, cancellation, availability, payment, provider, and page settings live in one site-wide `must_hotel_booking_settings` option; there is no tenant/property discriminator. |
| `src/Admin/SettingsPage.php` — `handleSettingsSave()`, provider/setup and hotel/contact fields | The WordPress administrator configures one hotel's identity and operational policy, including the selected PMS/payment setup.  Task 6 must replace this with the ADR-0016 widget configuration only. |
| `src/Core/ManagedPages.php`, `src/Core/PublicCallbackUrl.php`, `src/Core/Plugin.php` | One WordPress site owns the generated booking/confirmation/staff pages, REST callback base URL, rewrite/hooks, and lifecycle cron configuration. |
| `src/Frontend/*.php`, `frontend/templates/*.php`, `src/Elementor/*.php` | Public pages and Elementor widgets read the local configuration and local room/reservation data, so “this site is this hotel” is embedded throughout rendering. |
| `src/Provider/ProviderManager.php`, `ProviderRegistry.php`, `ProviderCapabilities.php` | A single site-wide `provider_mode` selects local booking logic, direct Clock, or Clock WBE Inline; shared MUST determines the property/PMS per backend tenant instead. |
| `src/Database/install-tables.php` — `install_tables()` and schema upgrade helpers | Creates a complete hotel data store with `{$wpdb->prefix}mhb_*` tables, all scoped solely by the WordPress database prefix (not tenant/property). |
| `src/Database/*Repository.php` (rooms, inventory, pricing, availability, guests, reservations, payments, refunds, provider mappings/logs/jobs) | Repository queries rely on a single site database and local integer IDs; none carries MUST `tenant_id`/`property_id`.  These stores must not remain authoritative once the plugin becomes a shared-backend client. |
| `src/Core/RoomCatalog.php`, `RoomData.php`, `RoomViewBuilder.php`; `src/Frontend/single-room-page.php`, `accommodation-page.php` | Local WordPress room posts/tables and their catalog are treated as the property inventory and public room model. |
| `src/Core/StaffAccess.php`, `src/Portal/*`, `frontend/templates/staff-*`, `frontend/templates/portal/*` | The plugin contains a whole per-hotel staff portal and WordPress capability/session boundary.  It is not part of the guest widget and conflicts with MUST's staff application/authorization boundary. |

## 2. Stored Clock PMS credentials and direct Clock call surfaces

### Credentials and identity stored in WordPress

| File(s) and symbol(s) | Current behavior |
| --- | --- |
| `src/Core/MustBookingConfig.php` — `get_clock_settings()`, `group_defaults()`, `normalize_provider()` | Stores Clock environment/base URLs, region/API type, subscription ID, account ID, API user/key, property ID, WBE hotel ID, endpoint paths/overrides, webhook secret, SNS Topic ARN, and Basic-auth username/password in the site option. |
| `src/Provider/Clock/ClockConfig.php` | Reads that option and exposes all Clock credentials, identities, endpoint configuration, webhook settings, and payment-posting configuration to the direct provider implementation. |
| `src/Admin/SettingsPage.php` — provider form processing around `clock_api_user`, `clock_api_key`, `clock_property_id`, `clock_wbe_hotel_id`, and webhook fields | Saves and renders the credentials/Clock property identity; retained settings must not include these secrets. |
| `src/Admin/SettingsDiagnostics.php`, `src/Core/SupportDiagnosticsEndpoint.php`, `tools/clock-*.php`, `tools/provider-preflight-report.php` | Diagnose the local site's Clock configuration and use it to probe/sync the provider; they are legacy operational surfaces, not widget behavior. |

### Direct HTTP transport (one transport path)

| File(s) and symbol(s) | Current behavior |
| --- | --- |
| `src/Provider/Clock/ClockApiClient.php` — `get()`, `request()` | Central direct Clock client: builds configured Clock URLs, logs/caches requests, and sends them via `ClockDigestTransport`; all direct Clock feature calls route through this client. |
| `src/Provider/Clock/ClockDigestTransport.php` — `request()` | Performs Clock Digest-auth challenge/retry and calls WordPress `wp_remote_request()`; this is the concrete network transport. |
| `src/Core/SupportDiagnosticsEndpoint.php` — Clock diagnostic request; `tools/provider-preflight-report.php` — `probeClock()` | Additional direct callers of `ClockApiClient::request()` for support/CLI diagnostics. |

### Every feature-level direct Clock call site

| File(s) and symbol(s) | Direct Clock responsibility currently owned by the plugin |
| --- | --- |
| `src/Provider/Clock/ClockCatalogService.php` — `fetchCatalog()`, `fetchRoomTypes()`, `fetchRooms()`, `fetchRates()`, `fetchWbeRoomTypeRates()`, `fetchRatePlans()` | Fetches Clock catalog data and stores local mappings/cache. |
| `ClockAvailabilityProvider.php` — `getAvailableRooms()`, `getDisabledDates()`, `checkAvailabilityFresh()`, `ratesAvailabilityRequest()` | Queries Clock availability/restrictions and combines them with local mappings/inventory. |
| `ClockQuoteProvider.php` — `calculateTotal()`, `buildCheckoutRoomItems()`, `productsRequest()` | Obtains Clock product/rate quotes and normalizes them into legacy local pricing data. |
| `ClockConnectionDiagnostic.php` — diagnostic connection method | Performs a direct configured Clock connection check from the WordPress administration flow. |
| `ClockReservationProvider.php` — `createReservations()`, `createClockBooking()`, `rollbackUnassignedClockBooking()` | Searches guests, creates/cancels Clock bookings, and binds them to local reservations. |
| `ClockReservationAmendmentService.php` — amendment request method | Sends a direct Clock reservation amendment. |
| `ClockReservationSyncService.php` — `syncBookingsWindow()`, `refreshBookingById()`, `fetchBooking()` | Periodically reads Clock bookings and upserts local reservation/guest state. |
| `ClockInboundSyncService.php` — `processInboundPayload()`, `executeRefreshJob()`, `executeBookingUpsertJob()` | Accepts Clock events, fetches Clock data, and maps provider statuses into local state. |
| `ClockWebsiteReferenceSyncService.php` — `syncReservationReference()`, `fetchBooking()` | Writes/validates the local website booking reference against Clock booking data. |
| `ClockRoomStatusService.php` — `fetch()` | Reads direct Clock physical-room statuses. |
| `ClockFolioService.php` — `listBookingFolios()`, `createDepositFolio()`, `viewFolio()`, `paymentSubTypes()`, `postCreditItem()`, `findCreditItemByReference()`, `verifyFolioBalance()` | Reads/creates folios and posts/reconciles payment credit items directly in Clock. |
| `ClockPaymentReconciliationService.php` — `reconcilePaymentSucceeded()`, `reconcilePaymentFailed()`, operational update methods, `executeSyncJob()` | Reconciles payment, cancellation, check-in/out, room/stay/guest updates and pricing between local records and Clock. |
| `ClockFolioPaymentSyncService.php`, `ClockFolioRefundSyncService.php`, `ClockPaymentAccountingService.php` | Drive the folio/payment-accounting and refund posting flows using `ClockFolioService`. |
| `ClockSyncScheduler.php`, `ClockReservationAutoSyncScheduler.php`, `src/Provider/Sync/ProviderSyncJobRunner.php` | Schedule/execute the local site's Clock catalog/reservation/payment sync jobs and locks. |
| `src/Engine/PaymentRefundService.php` — Clock cleanup request | Makes a direct `ClockApiClient::request()` as part of refund/financial cleanup. |

## 3. Stored Stripe/PokPay credentials and direct payment call surfaces

### Credential storage/configuration

| File(s) and symbol(s) | Current behavior |
| --- | --- |
| `src/Core/MustBookingConfig.php` — `payments_summary` defaults/normalization | Stores Stripe publishable, secret, and webhook keys for legacy/local/staging/production environments, plus PokPay merchant ID, key ID, and key secret for local/staging/production, in the site option. |
| `src/Engine/PaymentEngine.php` — `getStripeEnvironmentCredentials()`, `getStripeSecretKey()`, `getStripeWebhookSecret()`, `getPokPayEnvironmentCredentials()`, `getPokPayCredentialState()` | Selects the credential set from the current WordPress site environment and exposes it to provider calls. |
| `src/Admin/PaymentAdminActions.php` — payment settings save/test actions; `src/Admin/payments.php`; `src/Admin/SettingsPage.php` | Lets the WordPress hotel administrator save, test, display readiness for, and operate with those credentials. |
| `src/Engine/PaymentEnvironmentCompatibilityPolicy.php` | Couples payment availability to WordPress site environment (local/staging/production), another legacy single-install concern. |

### Direct Stripe/PokPay calls and webhooks

| File(s) and symbol(s) | Direct provider responsibility currently owned by the plugin |
| --- | --- |
| `src/Engine/PaymentEngine.php` — `performStripeApiRequest()` | Central direct Stripe REST transport using `wp_remote_request()` and the locally stored Stripe secret. |
| `PaymentEngine.php` — `createStripeCheckoutSession()`, `getStripeCheckoutSession()`, `syncStripeReturnSession()`, `handleStripeWebhookRequest()` | Creates/reads Stripe Checkout sessions and verifies/handles Stripe webhook/return state locally. |
| `PaymentEngine.php` — `performPokPayApiRequest()`, `verifyPokPayCredentials()`, `createPokPaySdkOrder()`, `getPokPaySdkOrder()`, `finalizePokPayOrder()`, `refundPokPaySdkOrder()` | Obtains tokens, verifies credentials, creates/reads/finalizes orders, and refunds through PokPay directly. |
| `PaymentEngine.php` — `registerRestRoutes()`, `handlePokPayFinalizeRequest()`, `handlePokPayErrorRequest()`, `handlePokPayWebhookRequest()` | Owns PokPay browser-return and webhook endpoints on the WordPress install. |
| `src/Engine/Payment/StripePayment.php` — `process()`, `refund()` | Gateway adapter that creates Stripe Checkout and directly requests Stripe refunds. |
| `src/Engine/Payment/PokPayPayment.php` — `process()`, `refund()` | Gateway adapter that creates embedded/redirect PokPay checkout and directly requests refunds. |
| `src/Engine/PaymentRefundService.php` — `requestStripeRefund()`, `requestPokPayRefund()` | Local refund workflow calls both provider APIs, records manual-review outcomes, and optionally performs Clock cleanup. |
| `src/Engine/PaymentProviderFeeService.php` — `captureStripeFeeSnapshotForReservations()`, `capturePokPayFeeSnapshotForReservations()` | Fetches provider fee/payment data and stores local fee snapshots. |
| `src/Frontend/confirmation-page.php` — checkout/return handlers and `mustHotelBookingPokPay` localization | Renders and controls the legacy checkout/embedded PokPay client flow; it is not a MUST API widget flow. |
| `tools/provider-preflight-report.php` | Executes optional direct Stripe balance and PokPay order probes from the local installation. |

## 4. Legacy booking domain/state logic that MUST now owns

| File(s) and symbol(s) | Local domain behavior that must not remain authoritative |
| --- | --- |
| `src/Engine/ReservationEngine.php` — selection handlers, `ensureRoomLock(s)`, `createGuest()`, `continueCheckout()`, `createReservations()`, `createReservation()`, `submitCheckout()` | Builds booking context, locks inventory, creates guests/reservations, generates booking IDs, and drives checkout from WordPress. |
| `src/Engine/BookingStatusEngine.php` — `updateReservationStatuses()`, `createPaymentRows()`, `failPending*Reservations()` | Defines and changes reservation/payment status transitions, events, pending-payment recovery, and confirmation text. |
| `src/Core/ReservationStatus.php`, `src/Engine/BookingValidationEngine.php`, `src/Engine/BookingRules.php`, `src/Engine/BookingQuoteDraft.php` | Defines legacy status vocabulary/validation, booking rules, and locally stored quote-draft semantics. |
| `src/Engine/ReservationConfirmationService.php`, `ReservationConfirmationAuthorization.php`, `ReservationConfirmationPolicy.php` | Authorizes/fulfills confirmation and links it to payment/provider state. |
| `src/Engine/ReservationAmendmentService.php`, `CancellationEngine.php`, `CancellationFinancialCleanupService.php` | Implements guest/staff amendment, cancellation, refund eligibility, and post-cancellation cleanup against local records. |
| `src/Engine/AvailabilityEngine.php`, `AvailabilityRulesService.php`, `AvailabilityAjaxController.php` | Calculates local availability, disabled dates, restrictions, selection state, and exposes legacy AJAX behavior. |
| `src/Engine/InventoryEngine.php`, `LockEngine.php`; `src/Database/InventoryRepository.php`, `AvailabilityRepository.php` | Maintains local inventory units, availability blocks/rules, and temporary locks. |
| `src/Engine/PricingEngine.php`, `RatePlanEngine.php`, `CouponService.php`; pricing/rate/coupon/tax repositories | Computes prices, taxes, fees, coupons, seasonal/rate-plan rules and checkout line items in WordPress. |
| `src/Engine/PaymentEngine.php`, `PaymentAttemptIntegrity.php`, `PaymentVerificationIntegrity.php`, `PaidProviderOutcomeService.php`, `OfflinePaymentConfirmationService.php` | Owns payment-attempt binding, provider observation, offline payment and payment completion state locally. |
| `src/Database/ReservationRepository.php`, `GuestRepository.php`, `PaymentRepository.php`, `RefundRepository.php`, `PaymentVerificationRepository.php`, `PaidProviderObservationRepository.php`, `PublicBookingAccessRepository.php` | Persists the authoritative legacy booking, guest, payment/refund, verification, and guest-access records in the WordPress database. |
| `src/Engine/PublicBookingAccessService.php`, `src/Engine/BookingAbuseProtection.php` | Issues/checks local public booking access and anti-abuse controls rather than MUST's guest-session and API authorization model. |
| `src/Engine/EmailEngine.php`, `EmailLayoutEngine.php` | Generates legacy hotel booking/payment email lifecycle messages from local records/configuration. |

## 5. Other migration-sensitive surfaces

| File(s) and symbol(s) | Why it needs removal or redesign |
| --- | --- |
| `src/Admin/Accommodation*`, `Availability*`, `Pricing*`, `Coupon*`, `Guest*`, `Reservation*`, `Payment*`, `Report*` and corresponding `src/Admin/*.php` views | WordPress admin is a second PMS/booking back office over the local database; it must not diverge from shared MUST data. |
| `src/Portal/*` and `frontend/templates/portal/*` | A full staff portal duplicates staff-facing capability/session/data access; outside guest-widget scope. |
| `src/Database/DefaultInventoryUnitSyncService.php`, `AccommodationCategoryUpgradeService.php`, `DangerousResetService.php` | Local installation/seed/migration/reset logic assumes it owns hotel domain data. |
| `src/Provider/Storage/*` | Local provider mappings, request logs, and sync jobs bind a WordPress installation to one provider account/property. |
| `src/Core/ActivityLogger.php`, `BookingPerformanceMonitor.php`, `SupportDiagnosticsEndpoint.php` | Operational telemetry/diagnostics are based on local bookings/providers and may reveal local integration state; retain only if explicitly useful for widget diagnostics. |
| `src/Core/Updater.php`, `must-hotel-booking.php` | Plugin update/support configuration includes a site-local GitHub token constant; it is unrelated to the public API but must not become a substitute for the prohibited plugin backend credential. |
| `frontend/templates/booking*.php`, `checkout.php`, `booking-confirmation.php`; `src/Frontend/booking-page.php`, `booking-selection.php`, `checkout-page.php`, `confirmation-page.php` | UI is coupled to the local engines, provider returns/webhooks, and local reservations. Tasks 3–7 must preserve only presentation/layout while replacing data/actions with MUST public API calls. |

## Verification limits and Task 3 prerequisite

The audit is source-based. `php` is not installed in this environment, so the existing
standalone PHP tests and `pnpm lint:wordpress-plugin` cannot run.  Install a PHP CLI
before Task 3 needs syntax checks or any legacy PHP test execution.  No functional
verification, WordPress boot, database migration, or external Clock/Stripe/PokPay
operation was attempted for this read-only task.
