=== MUST Hotel Booking ===
Contributors: must
Tags: hotel, booking, reservation, accommodation
Requires at least: 5.0
Tested up to: 6.0
Requires PHP: 7.4
Stable tag: 0.4.92
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

MUST Hotel Booking manages accommodations, availability, reservations, pricing, checkout, and hotel operations directly inside WordPress.

== Description ==

MUST Hotel Booking helps hotel teams manage accommodation sales and daily operations from WordPress without splitting booking data across separate systems.

Main features include:

* Accommodation and room management for hotel inventory
* Availability, reservations, guest records, and payment tracking
* Pricing controls for rate plans, seasons, taxes, coupons, and checkout flows
* Staff-facing hotel operations tools inside WordPress admin and the staff portal
* Managed booking pages, notifications, diagnostics, and maintenance utilities

== Installation ==

1. Upload the `must-hotel-booking` folder to `/wp-content/plugins/`, or install the release ZIP from **Plugins > Add New > Upload Plugin**.
2. Activate **MUST Hotel Booking** from the WordPress Plugins screen.
3. Open **MUST Hotel Booking > Settings** and review hotel identity, booking rules, managed pages, payment methods, and email settings.
4. Add accommodations, configure availability and pricing, and test the booking flow before going live.
5. When updating, upload the new release ZIP or use the configured updater, then review **Diagnostics & Maintenance** after the update completes.

== Changelog ==

= 0.4.92 =
* Aligned Clock transport, endpoint validation, rate-limit handling, write recovery, and folio credit-item reconciliation with the official Clock API contract.
* Added production safeguards for refunds, payment-failure transactions, PHP 7.4 compatibility, public booking access, cancellation-policy revalidation, and keyboard focus.

= 0.4.88 =
* Fixed : Sychronization

= 0.4.87 =
* Added : Calendar Mode , Multipl Night Payment Mode

= 0.4.86 =
* Folio fix

= 0.4.85 =
* Fix booking flow performance and final Clock revalidation

= 0.4.84 =
* Added booking-flow performance timing, a sanitized slow-request admin timeline, and correlation IDs.
* Prevented Clock auto-sync from draining large remote batches in one WP-Cron request.
* Added signed server-side booking quote drafts and short safe caches for Clock availability and product reads.

= 0.4.83 =
* Fix PokPay deposit folio and payment diagnostics

= 0.4.82 =
* Hardened Clock inbound retry and deduplication, room move and pre-arrival room-type amendments, cancellation and refund lifecycle safety, and Clock payment and refund accounting.
* Real Clock SNS acceptance and real Clock amendment acceptance remain blocked; checked-in Clock room moves remain unsupported and some Clock accommodation-charge cleanup stays manual.

= 0.4.81 =
* Added Clock PMS SNS webhook support and improved Stripe, PokPay, Clock payment, refund, cancellation, and duplicate-event reliability.

= 0.4.80 =
* Production readiness release with Stripe/PokPay payment and refund idempotency, Clock deposit folio accounting, cancellation/refund separation, retry hardening, and release packaging cleanup.

= 0.4.79 =
* minor update

= 0.4.78 =
* minor portofolio update

= 0.4.77 =
* general impro

= 0.4.76 =
* pokpay

= 0.4.75 =
* clock,stripe,pokpay integration and testing

= 0.4.74 =
* Clock PMS Folio Payment Accounting

= 0.4.73 =
* Added Clock folio accounting for successful external website payments and refunds with admin review status.

= 0.4.72 =
* Made PokPay the primary online payment method and added server-side PokPay refund support with manual fallback tracking.

= 0.4.71 =
* Email Logo and Google Maps Link

= 0.4.70 =
* stripe webhook succes update

= 0.4.69 =
* portal booking udpate

= 0.4.68 =
* portal updateeee

= 0.4.67 =
* portal updateee

= 0.4.66 =
* portal updatee

= 0.4.65 =
* portal update

= 0.4.64 =
* update

= 0.4.63 =
* update

= 0.4.62 =
* update agian

= 0.4.61 =
* update the previous issue

= 0.4.60 =
* update to the matter

= 0.4.59 =
* Quick booking now shows room name/type labels, uses two Flatpickr calendars with selected-room unavailable dates disabled, submits ISO dates to fix the invalid-date error, and the updated PHP/JS syntax checks pass.

= 0.4.58 =
* Quick Booking now creates mapped individual-room bookings through ClockPMS, keeps unavailable/failed previews from submitting, and the reservation detail page has a cleaner normal admin layout.

= 0.4.57 =
* minor fix with the editing of rooms

= 0.4.56 =
* Added Clock-mode guaranteed individual room booking with public room-unit metadata, frontend unit cards, exact physical-room availability checks, Clock-derived pricing, and safe checkout blocking when the selected room cannot be confirmed in Clock.

= 0.4.55 =
* expand the diagnositc

= 0.4.54 =
* Added production readiness diagnostics for Stripe, Clock, inventory, email, cron, and security checks to identify launch blockers, warnings, and manual operations before going live.

= 0.4.53 =
* css change

= 0.4.52 =
* Added staff portal immediate action to mark manual Clock folio payment accounting as done after staff manually posts the website Stripe payment in Clock PMS.

= 0.4.51 =
* Fixed staff portal and payments critical errors caused by missing local payment status and amount-paid initialization in the manual Clock folio notice logic.

= 0.4.50 =
* Expanded staff portal manual Clock folio payment notices to show for paid Clock-backed Stripe bookings even when folio sync metadata was not saved, using payment rows as fallback for amount and Stripe reference.

= 0.4.49 =
* Expanded staff portal manual Clock folio payment notices to detect missing Clock folio API permission from provider sync errors, not only provider metadata.

= 0.4.48 =
* Added staff portal notices for Clock-backed Stripe bookings when Clock folio payment posting is blocked by missing API rights, showing the manual Clock PMS payment-entry instruction with amount and Stripe reference.

= 0.4.47 =
* Changed diagnostics so missing Clock API right pms_api_booking_folios_default is treated as a known manual Clock folio payment/accounting state while waiting for Clock permissions.

= 0.4.46 =
* Added Clock folio payment posting for successful website Stripe payments. The plugin now fetches the default Clock folio for the booking, saves the folio ID locally, and posts a positive Clock credit item with the Stripe PaymentIntent reference.

= 0.4.45 =
* Changed diagnostics so successful Stripe refunds that only require manual Clock folio/accounting review are treated as a known manual accounting state instead of a critical plugin failure.

= 0.4.44 =
* Added a read-only Clock folio readiness check to diagnostics. If the latest paid Clock booking does not have a folio ID saved locally, diagnostics now fetches the Clock booking and reports whether Clock exposes a folio ID before any refund is tested.

= 0.4.43 =
* Added Clock folio ID recovery before refund sync. When a Stripe refund is requested and the local reservation does not already have a Clock folio ID, the plugin now fetches the Clock booking, tries to recover the folio ID, saves it to reservation metadata, and only falls back to manual review if Clock still does not provide one.

= 0.4.42 =
* Added future refund readiness diagnostics to show whether the latest paid Clock booking has a Clock folio ID available for automatic refund sync.

= 0.4.41 =
* Improved refund diagnostics so Clock manual-review refunds now expose the stored failure reason, including missing Clock folio IDs or Clock refund sync API errors, instead of showing an empty latest_error value.

= 0.4.40 =
* Clock diagnostics now include an automated Phase 1 trial summary, confirming whether the latest paid Stripe booking was created locally, synced to Clock, confirmed locally, and completed without creating a false Clock payment-update failure when payment sync is intentionally local-only.

= 0.4.39 =
* This release fixes Phase 1A/1B operational issues found by the support diagnostics report. It self-heals missing plugin cron schedules, especially expired lock cleanup, and changes Clock payment reconciliation so missing Clock payment/status update endpoints are treated as intentional local-only sync instead of false provider failures.

= 0.4.38 =
* rmeove phaso0 maybe

= 0.4.37 =
* Fixed phase0 mistake 0.2

= 0.4.36 =
* Fixed phase0 msitakes ?

= 0.4.35 =
* Added a temporary token-protected support diagnostics endpoint that can be enabled from plugin settings to expose sanitized plugin, Clock, Stripe, sync, cron, and error status for troubleshooting.

= 0.4.34 =
* Added a MUST plugin support chat widget for all logged-in users inside the plugin admin pages and staff portal.

= 0.4.33 =
* Fixed staff portal Stripe refunds for Clock-backed reservations, added fixed/percentage partial refund handling, and prevented partial refunds from accidentally processing as full refunds.

= 0.4.32 =
* Fixed provider-backed Stripe refunds from the staff portal so Clock-backed reservations can be refunded from the Payments workspace instead of being incorrectly redirected as read-only.

= 0.4.31 =
* Fixed staff portal login so valid staff users are no longer incorrectly blocked with “No portal modules are currently enabled for your account.”

= 0.4.30 =
* Use website-local accommodation images and amenities for Clock physical room displays
* Fixed staff portal access for active plugin staff users by syncing role capabilities during staff creation and login

= 0.4.29 =
* Fixed Stripe checkout selection in Clock backend mode so website payments use enabled plugin gateways instead of Clock PMS
* Added public room content fallbacks for Clock physical rooms, including provider images and feature labels when available
* Prevented internal Clock import notes from showing as public room descriptions

= 0.4.28 =
* Added Stripe refund tracking with admin and portal refund controls plus Clock folio refund sync support
* Added Clock endpoint defaults and increased mobile top padding on non-home pages
* Fixed Clock physical room list and detail displays to show physical room names, descriptions, features, nightly price, and similar rooms

= 0.4.27 =
* Fixed Clock automatic sync scheduler PHP file formatting so the namespace declaration loads correctly in production

= 0.4.26 =
* Added configurable automatic Clock reservation sync using WP-Cron
* Added Clock sync interval and batch size settings
* Automatically refreshes active Clock-backed reservations from Clock PMS on schedule

= 0.4.25 =
* Wrapped Clock reservation cancellation requests in the expected booking payload and used the Clock canceled status value for provider-side cancellation

= 0.4.24 =
* Added HTTP method support for configurable Clock reservation mutation endpoints
* Allowed Clock cancel/update paths to use POST, PUT, PATCH, DELETE, or GET prefixes
* Prevented request bodies on GET and DELETE mutation calls

= 0.4.23 =
* Allowed provider-backed admin GET cancellation actions so the Cancel in Clock button reaches the Clock cancellation service and creates Provider Logs

= 0.4.22 =
* Added visible Clock reservation cancellation and update endpoint settings
* Enabled provider-side Clock cancellation adapter when a cancellation endpoint is configured
* Improved missing Clock mutation endpoint warnings

= 0.4.21 =
* Fixed Clock reservation creation to use the quoted Clock rate ID
* Fixed Clock guest search parameter
* Hid raw Clock booking errors from public checkout while keeping the real provider error in Provider Logs
* Added sanitized request body logging for Clock API requests

= 0.4.20 =
* Added Provider Logs admin page for Clock API debugging
* Added direct booking diagnostic for availability, quote, and rate-plan pricing checks
* Added recent Clock request and response log viewer

= 0.4.19 =
* Fixed booking calendar unavailable dates disappearing after date selection
* Reapplied unavailable-date classes when Flatpickr redraws calendar days
* Preserved known Clock unavailable dates when disabled-date refresh fails open

= 0.4.18 =
* Preloaded booking-calendar disabled dates before Flatpickr initialization so unavailable dates render immediately on direct room booking URLs.
* Added first-available check-in and checkout fallback dates when the current selected dates are unavailable.
* Added disabled checkout/departure dates for the second booking calendar in Clock backend mode.
* Kept Clock disabled-date windows anchored from today while using the selected check-in only for departure-date calculation.
= 0.4.17 =
* Changed Clock backend room-list cards and booking-page selection to use synced physical rooms as the bookable item while keeping the parent Clock room type for gallery, rates, and room-type availability.
* Filtered Clock search, disabled dates, checkout locks, and local mirrors by the selected physical room when one is selected.
* Sent selected Clock physical room IDs in reservation creation and stored local mirrors as parent room type plus assigned physical room.
* Added fallback Clock rate-plan pricing from public mapped rates when a synced Clock room type has no local rate assignment.

= 0.4.16 =
* Fixed Clock rates availability requests to use Clock's documented GET bracket-array query format instead of POST JSON or WordPress indexed query arrays.
* Fixed Clock product search requests and parsing so nested Clock room-type/rate products produce public rate plans and prices.
* Tightened Clock stay availability checks so a stay is available only when the same Clock rate is available for every booked night.

= 0.4.15 =
* Sent Clock rates availability checks as JSON POST requests with integer rate and room type IDs so Clock can validate availability requests correctly.
* Kept Clock availability strict for room search and checkout while preserving calendar diagnostics when Clock rejects a request.

= 0.4.14 =
* Improved Clock disabled-date parsing so the calendar can read flat, nested, and date-keyed availability rows instead of showing unknown dates as free.
* Preserved strict Clock search and checkout validation while making calendar hints reflect unavailable Clock dates when the response contains parseable per-day signals.

= 0.4.13 =
* Fixed Clock disabled-date loading so incomplete Clock configuration, mappings, or API responses no longer disable every public check-in date.
* Added disabled-date diagnostics to the availability AJAX response while keeping actual Clock search and checkout availability checks strict.
* Updated Clock backend calendar data so synced physical rooms can display as calendar rows while restrictions, locks, and actions still resolve through their source room type.

= 0.4.12 =
* Preserved the selected arrival date when the booking calendar refreshes disabled-date diagnostics after a guest selects dates.
* Renamed the Clock backend booking selector default from "All Clock room types" to "All Room Types".

= 0.4.11 =
* Expanded Clock full sync to assign synced rates to Clock room types and mirror recent/future Clock bookings into local reservations.
* Added Clock booking mirror refresh support for arrivals, departures, guest records, physical rooms, rate plans, provider status, and balance-derived payment status.
* Updated Clock backend room-list widgets so synced physical rooms display under each Clock room type while booking still targets the parent room type.
* Restricted Clock backend checkout payment choices to Clock PMS payment ownership instead of exposing local Stripe or pay-at-hotel methods.

= 0.4.10 =
* Updated Clock backend mode so public booking selectors and room-list widgets use synced Clock room types instead of legacy local categories.
* Routed Clock availability checks and disabled-date lookups through the selected synced Clock room type when guests choose a specific type.
* Clarified the Clock sync panel so catalog/mapping sync is separate from guest, reservation, and staff bulk sync endpoints that still need exact Clock API support.

= 0.4.9 =
* Added a primary Clock full sync action that refreshes the catalog, imports missing local Clock room/rate records, and creates provider mappings where safe.
* Reworked Clock diagnostics into a clearer synchronization panel with catalog counts and advanced troubleshooting actions.
* Simplified Clock catalog previews so admin users see readable room/rate lists instead of raw metadata blobs.

= 0.4.8 =
* Reworked the Provider settings tab into a guided setup choice for Plugin backend, Clock WBE inline, or Clock PMS backend.
* Hid normal Clock endpoint paths behind an advanced diagnostics section and defaulted them automatically for Clock PMS backend mode.
* Reduced Clock setup fields to the account-specific inputs needed for the selected mode.

= 0.4.7 =
* Added a one-click Clock API defaults action so endpoint paths self-configure and hotel-specific credentials stay as the only required manual inputs.
* Updated Clock provider readiness messages to reflect the implemented availability, product search, booking creation, and webhook payload handling adapters.
* Improved direct Clock setup defaults for booking create and booking fetch paths on existing installations with blank saved endpoint fields.

= 0.4.6 =
* Added Clock PMS sandbox credential settings, endpoint defaults, safe connection testing, and redacted request diagnostics for failed API calls.
* Added Clock PMS catalog sync for room types, rooms, and rates, with admin counts, cached record display, and mapping diagnostics.
* Added Clock PMS public availability and search adapters using `/rates_availability` and `/products`, including WRS public-rate visibility filtering.
* Added Clock booking creation via `POST /bookings/`, returning guest lookup through `/guests/search`, local mirror reservation metadata, and booking webhook refresh support.

= 0.4.5 =
* Added PokPay payment method integration for booking deposits and reservation payment tracking.
* Added PokPay checkout and confirmation handling with frontend status messaging and dashboard/payment diagnostics.
* Added admin settings and payment views for PokPay configuration, payment state review, and manual operational follow-up.

= 0.4.4 =
* Added structured direct Clock API settings for region, API type, subscription/account IDs, endpoint resolution, and Digest authentication transport.
* Added Clock catalog fetch/cache diagnostics and mapping helpers for room types, rooms, rates, WBE room-type rates, and rate plans.
* Made direct Clock API booking and reservation-update paths fail closed with clearer admin diagnostics, retry/error categories, and optional local fallback control while the real adapters remain unavailable.

= 0.4.3 =
* Restored the guest-count field in the public Booking Search widget UI while keeping the Clock WBE inline form limited to Clock's documented field names.
* Improved room-details linking so the Rooms List widget can keep showing `Additional Details` even when the managed Rooms page is not explicitly assigned, by resolving a usable single-room host page from supported Elementor room pages.
* Tightened Clock WBE inline CTA styling on room details surfaces so `Book Now` buttons keep the existing flat appearance without border radius or hover color changes.

= 0.4.2 =
* Added a separate `website_booking_flow_mode` so public frontend booking can switch between the plugin checkout flow and Clock WBE Inline without changing `provider_mode`.
* Added Clock WBE Inline frontend support: inject the configured Clock head snippet on normal public pages, open WBE directly from Rooms List and single-room Book Now CTAs, and submit the Booking Search widget through `data-clock-pms-wbe-form`.
* Bypassed the legacy `/booking`, `/booking-accommodation`, and `/checkout` plugin pages while Clock WBE Inline mode is active, while keeping `/booking-confirmation` available only for recognized local confirmation and cancellation contexts.
* Added admin and staff warnings clarifying that WBE-origin website bookings are created in Clock and may not appear locally until real Clock API sync is configured.
* Preserved the existing plugin checkout flow, provider architecture, Stripe settings, and Clock API provider implementation unchanged outside the new public flow mode.

= 0.4.1 =
* Added optional public booking anti-spam protections with a hidden honeypot, minimum submit-time checks, and configurable throttling for checkout and confirmation submissions.
* Added Booking Rules controls for enabling anti-spam checks, tuning thresholds, and turning blocked-attempt logging on or off.
* Added diagnostics visibility for booking protection status and recent blocked reservation attempts.
* Added safe frontend tracking and hidden-field rendering without changing the visible booking layout.
* Applied the protection layer to both Local reservations and Clock PMS mirrored reservations.

= 0.4.0 =
* Added Clock PMS provider integration — the plugin now supports two booking modes: Local (self-contained, unchanged) and Clock (mirrors reservations to an external PMS via REST API).
* Added provider infrastructure: `ProviderManager`, `ProviderMappingRepository`, `ProviderSyncJobRepository`, `ProviderRequestLogRepository`, and supporting value objects for routing all booking operations through the active provider.
* Added Clock availability, quote, reservation creation, payment reconciliation, cancellation, room assignment, stay-date editing, guest-detail editing, and check-in/check-out flows via configurable REST endpoint paths with token substitution.
* Added inbound Clock sync: webhook receiver and refresh sync job apply provider status/payment updates to local mirror reservations.
* Added Clock catalog service for fetching remote accommodation, physical room, and rate plan lists and saving them as local provider mappings.
* Added provider-aware admin and staff portal actions: cancel, check-in, check-out, room move, stay-date edit, and guest-detail edit route to Clock when the reservation is a Clock mirror.
* Added provider-aware reporting: booking source breakdown, sync error and payment mismatch issue counts, and Provider column in audit log and CSV exports.
* Added Clock diagnostics panel: readiness checklist, mapping management UI (accommodation/rate plan/physical room inline add/delete), sync health summary, and last-error display.
* Added three new database tables: `mhb_provider_mappings`, `mhb_provider_request_logs`, `mhb_provider_sync_jobs`. Tables are created automatically on upgrade via `dbDelta`.
* Hardened Clock API contract handling: non-JSON 2xx responses now surface a `bad_response_body` error; unresolved path tokens in endpoint URLs fail fast with a clear operator message instead of sending a malformed request.
* Local mode behavior, all existing frontend pages, booking flow, payment handling, admin panels, and staff portal are unchanged.

= 0.3.49 =
* Standardized booking-flow mobile shell spacing so the managed booking, accommodation, checkout, and confirmation views use `120px` top/bottom padding and `20px` left/right padding on phones.
* Matched the mobile booking-confirmation success copy block to the same `120px 20px` spacing so the flow feels consistent across the managed frontend pages.

= 0.3.48 =
* Fixed booking-flow mobile shell behavior when the active theme or page builder wraps the managed booking pages in a narrow content container, so the booking layout can expand to the full viewport instead of rendering as a squeezed left column.
* Switched the booking-process container to a simple mobile flex-column stack at the narrowest breakpoint to avoid the desktop grid contributing to compressed phone layouts.

= 0.3.47 =
* Improved booking-page responsiveness on tablet and mobile so the calendar step header, stepper, summary controls, and dual-calendar layout fit smaller screens without horizontal overflow.
* Improved Select Accommodation responsiveness so filter controls, room cards, thumbnail galleries, and action buttons scale down more cleanly across tablet and phone layouts.


= 0.3.46 =
* Refined the booking and accommodation page shell with 140px gutters, a more structured desktop booking layout, improved contact-band placement, and clearer expanded-room visual feedback.
* Improved related-room presentation with tighter grid spacing, fluid CTA and icon sizing, and better action wrapping across desktop and mobile layouts.
* Cleaned the booking calendar UX by hiding the disabled previous-month control and fixing checkout month advancement when the checkout date starts empty.

= 0.3.44 =
* Added an admin-only Staff Users settings tab for creating, activating, deactivating, and deleting staff portal accounts without leaving the plugin settings workspace.
* Added plugin-managed staff account disable handling so disabled staff users are blocked from logging into the /staff/ portal and are signed out cleanly with a clear message.
* Improved staff-access management internals for portal-controlled user status, while keeping administrator accounts outside the staff-disable path.

= 0.3.43 =
* Completed the next portal-operations milestone by adding stay-date correction and no-show handling in Reservations, supervisor and manager block/rule control in Rooms & Availability, and a fuller Housekeeping workflow with assignments, maintenance issues, and shift handoff.
* Hardened the live staff portal for release by enforcing move-room authority for in-house stays, hiding finance-heavy reservation and dashboard data from roles without payment visibility, and aligning the default role matrix so Housekeeping assignment authority follows the intended Supervisor-led workflow.
* Cleaned portal release safety by shipping the active Housekeeping partial templates, removing dead portal compatibility leftovers after the module merges, and tightening release hygiene for future GitHub ZIP packaging.

= 0.3.42 =
* Expanded the `/staff/housekeeping/` portal module beyond the first room board by adding room assignment tracking, room-linked maintenance issues, and a first shift handoff workflow on top of the existing housekeeping status foundation.
* Added portal-safe housekeeping oversight so staff can assign rooms to housekeeping users, track open and resolved maintenance issues, and capture handoff snapshots with unresolved issue visibility for the next shift.
* Extended housekeeping activity and schema support so assignment, issue, and handoff actions stay inside the staff portal with actor-attributed audit history.

= 0.3.41 =
* Turned the `/staff/` portal into a real hotel operations workspace with role-based access across Dashboard, Reservations, Calendar, Front Desk, Guests, Payments, Housekeeping, Rooms & Availability, and Reports.
* Replaced standalone quick booking with the Front Desk workspace, including real new-booking flow, check-in and check-out queues, room move handling, and a front-desk activity log.
* Expanded reservation operations inside the portal with check-in, check-out, room assignment and reassignment, internal note append, cancellation request approval, and a dashboard approval queue for supervisors and managers.
* Added operational guest editing, payment posting and partial payments, Stripe refund handling, receipt and invoice generation, a first housekeeping room board, a merged rooms and availability workspace, an actionable calendar, and role-scoped reports with audit visibility.
* Improved activity logging, actor attribution, capability alignment, deprecated portal route handling, and updater metadata consistency for GitHub release packaging.

= 0.3.38 =
* Reworked the staff portal entry flow with a redesigned login experience, clearer staff-only messaging, stronger responsive behavior, and admin access that stays inside the same portal flow used by managers and workers.
* Redesigned the staff dashboard into an action-first operations workspace with stronger task hierarchy, portal-safe links, and admin-only system health items that link directly to the settings or workspace that needs review.
* Added a full reservation workspace inside the staff portal so front-desk teams can review attention items, update guest details and internal notes, resend reservation emails, and manage payment state without hopping back into wp-admin.
* Refined shared portal UI patterns with richer feed cards, stronger reservation status and action layouts, improved queue filtering, and more consistent responsive behavior across dashboard, reservation, and related staff screens.

= 0.3.37 =
* Added an Elementor booking search widget option to send guests directly to the Select Accommodation page instead of the main booking page when that flow is preferred.
* Fixed booking-calendar navigation so the shared previous and next month controls keep both check-in and checkout calendars moving together and keep the visible month labels in sync.
* Refined booking and accommodation frontend presentation with cleaner step header spacing, a desktop-only width fix for the Select Accommodation page title to prevent overlap with the booking stepper, responsive room thumbnail layouts, stacked mobile room actions, and cleaner room/widget media edge treatment.

= 0.3.36 =
* Added an Elementor booking search widget option to send guests directly to the Select Accommodation page instead of the main booking page when that flow is preferred.
* Fixed booking-calendar navigation so the shared previous and next month controls keep both check-in and checkout calendars moving together and keep the visible month labels in sync.
* Refined booking and accommodation frontend presentation with cleaner step header spacing, calendar shell spacing, responsive room thumbnail layouts, stacked mobile room actions, and cleaner room/widget media edge treatment.

= 0.3.35 =
* Reworked the wp-admin operations experience so Calendar, Accommodations, Rates & Pricing, Availability Rules, Payments, and Emails now share the same polished dashboard-style shell, cards, filters, badges, and action hierarchy.
* Improved long-form admin workspaces with clearer KPI strips, cleaner tools and filter sections, stronger grouping, and easier-to-scan tables and cards for day-to-day hotel operations.
* Refined supporting admin flows and shared styling so quick booking and related operational screens feel more consistent, intentional, and product-level across the plugin.

= 0.3.34 =
* Added automatic default inventory unit backfill and sync so existing accommodations and newly created room/listing records always get a sellable unit when none exists yet.
* Kept default units aligned with the accommodation's active, bookable, and calendar visibility flags, including rooms created manually in admin or imported from Excel.
* Added a booking fallback that uses the accommodation's own base price when no rate plan is assigned, so public booking does not fail just because pricing plans have not been configured yet.
* Fixed coupon data loading so newly created coupons appear correctly in admin and can be found during checkout validation.
* Added clearer checkout coupon feedback for guests, including friendly success and failure messages such as coupon not found, not active yet, expired, unavailable, minimum amount not met, or no discount applied.
* Fixed the accommodation editor toggle cards so booking behavior options in the modal can be clicked reliably again.

= 0.3.33 =
* Fixed a fatal admin/runtime load error caused by the new accommodation category repository declaring an incompatible `tableExists()` method signature.
* Corrected the category table availability checks so the accommodation category/listing split loads cleanly in WordPress.

= 0.3.32 =
* Split accommodations into admin-managed top-level categories and separate sellable room/listing records.
* Added a dedicated Categories view for creating, editing, deleting, and ordering accommodation categories in admin.
* Kept pricing, availability, reservations, and booking logic attached to room/listing records while separating physical units into their own admin view.
* Updated the Excel workflow so imports and exports manage room/listing records only and reference existing accommodation categories created in admin.
* Removed the old cleanup demo accommodation panel from the production admin UI and replaced the mixed-model cleanup with safer category-aware upgrade handling.

= 0.3.31 =
* Reworked the accommodation Excel workflow into a single manager-friendly sheet focused on accommodation details only.
* Removed Excel handling for accommodation units, operational inventory state, and live availability so those stay managed in WordPress admin.
* Added separate template and current-data workbook downloads for bulk accommodation creation and editing.
* Import now updates existing accommodations by id, creates new accommodations when id is blank, validates accommodation types row by row, auto-generates slugs for new records, and leaves images to the admin UI.

= 0.3.30 =
* The Danger Zone reset tools in Diagnostics & Maintenance are now visible by default for full administrators in wp-admin.
* Removed the wp-config feature-flag requirement for dangerous resets, while keeping the reset UI limited to `manage_options` users only.
* Existing destructive-action protections remain in place: server-side capability checks, nonces, explicit target selection, exact confirmation phrases, current WordPress password verification, and the final irreversible-action acknowledgment.
* Strengthened the Factory Reset card styling so the nuclear option reads as more dangerous than the operational reset.

= 0.3.29 =
* Added an admin-only Danger Zone in Diagnostics & Maintenance for destructive reset actions.
* Added separate reset flows for hotel operational data and full plugin factory reset, with clearer preserved-versus-deleted scope.
* Hardened destructive reset confirmation with a feature flag, full admin capability checks, target selection, exact confirmation phrases, current WordPress password verification, and a final irreversible-action acknowledgment.
* Factory reset now suspends managed page auto-create and routing until an administrator explicitly reassigns or recreates managed pages again.
* Improved the WordPress plugin card and details modal with a stronger plugin description, linked author metadata, and cleaner Description, Installation, and Changelog content.

= 0.3.28 =
* Hardened accommodation cleanup safety with guarded type deletion and explicit inventory-mirror repair tooling.
* Tightened GitHub release update validation, version alignment, and release asset matching.

= 0.3.18 =
* Maintenance release and plugin structure cleanup for WordPress conventions.
