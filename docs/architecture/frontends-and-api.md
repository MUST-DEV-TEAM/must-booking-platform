# Frontends and API boundaries

Status: **IMPLEMENTED**, with named placeholders and legacy residue. Code inspected 2026-09-19.

## Next.js staff and platform app

[Web app](../../apps/web/app) uses Next App Router. Auth screens share `auth-shell.tsx` and `auth-routing.tsx`. A platform user routes to `/platform`; tenant users use `/dashboard` as membership picker and `/dashboard/[tenantId]` with `propertyId`, `section`, `tab` and `settingsArea` query parameters. Tenant selection is not server-side session state.

`dashboard/dashboard-shell.tsx` owns role/capability-filtered navigation and the shared shell. Hotels and property selection are present; integrations are reachable under Settings, and Quick Booking hosts walk-in creation. Settings is a hub/subview structure; notifications include an inbox. Inventory, Approvals and System Health still render explicit unavailable states. The old separate `main-dashboard.tsx` is absent.

## Dashboard payments and guest pages (2026-10-01)

The Payments section is a list plus two linkable detail views, all driven by URL parameters on the same shell (`?section=payments&payment=<bookingId>` and `?section=guests&guest=<guestId>`), so a booking or a guest can be opened, bookmarked and shared.

- **List** ([payments.tsx](../../apps/web/app/dashboard/payments.tsx)): one row per booking with reference, guest, stay, separate Booking and Payment badges, and Total/Paid/Refunded/Outstanding columns; newest first; filter tabs with counts (All, Needs action, Outstanding, Paid, Refunded, Cancelled); search by reference, guest or email; per-currency totals; CSV export of the current view (spreadsheet formulas defused). Drafts that never reached payment are hidden.
- **Status rules** ([payment-status.ts](../../apps/web/app/dashboard/payment-status.ts)): the payment state is read together with the booking status. A cancelled (or failed/rejected) booking is "Refund due", "Partially refunded", "Refunded" or "Nothing paid", never "Paid" or "Due at hotel"; only a live booking owes money (outstanding is total minus paid, unchanged by refunds); "needs action" is money held against a booking that will not happen, or a stuck booking.
- **Payment page** ([payment-detail.tsx](../../apps/web/app/dashboard/payment-detail.tsx)): summary, every charge and refund from the ledger endpoint (provider reference, staff member, note), Clock folios, audit activity and the shared refund dialog ([payment-refund-dialog.tsx](../../apps/web/app/dashboard/payment-refund-dialog.tsx)). The ledger endpoint returns only whitelisted audit detail fields, never provider payloads.
- **Guest page** ([guest-detail.tsx](../../apps/web/app/dashboard/guest-detail.tsx)): profile from the newest booking, lifetime paid/refunded/net/outstanding, every booking linked to its payment page, and possible duplicate profiles (same email ignoring case, or same name). It is built from the property bookings list; there is no single-guest endpoint.
- **Overview tabs** (Overview, Needs Attention, Approvals, Quick Booking, System Health) switch in place: a plain click changes the tab and pushes the address with `history.pushState` (no page load); modified clicks still open the link, and back/forward follow the address. The Needs Attention tab reads `needsAttention` from `GET .../overview` (the bookings behind `needsAttentionCount`, newest first, up to 50); a missing list is treated as empty, because the tab once crashed when the API sent only the count.
- **Not built yet:** short addresses (the tenant and property IDs and `section=` still appear in the URL), guest notes and tags, a refund preview that shows the amount before confirming, an in-page view of Clock refund mirroring, and server-side paging for very large properties (the list loads all bookings).

Settings Payments, Branding and Website connection use shared form sections, dirty-only Save bars and the existing navigation guard. Read-only viewers cannot save or generate pairing codes. Payments show assigned provider readiness; the UI keeps at least one method enabled because the property contract has no separate online-booking switch. Branding previews draft email identity without sending mail. Website readiness requires both a saved public origin and WordPress pairing. Saves merge partial property responses (preserving pairing/connection state) and invalidate saved readiness/overview views immediately. Property writes are transactional; no next-day activation or day-long settings cache was found in these paths. A reported overnight delay still needs a concrete reproduction outside the confirmed dashboard stale-state fixes. Payments now offers Pay online in full (PokPay) and Pay at hotel; Stripe remains supported by the API and its saved flag is preserved. Method toggles, the 10-1440 minute hold and automatic-free-cancellation refund flag save together through the property PATCH. PokPay uses existing encrypted create/test/assign APIs; Replace creates a separate connection and assignment replaces only this hotel's PokPay account atomically. The adapter is staging-only, so Test is shown and Live is unavailable. The callback uses the existing `/api/webhooks/pokpay` route on the dashboard origin; deployments must expose that HTTPS route. Credentials are write-only, results are generic, and provider response bodies/credentials are omitted from PokPay logs. No provider tests were run live during implementation.

Branding picks PNG/JPG/WebP logos from the scoped photo library and reuses its upload/confirm API and 10 MB guard, preserving `photos.manage`. The sidebar uses the saved logo with the hotel name as fallback. Brand colour (`#RRGGBB`), optional plain-text email footer (300 characters), and optional HTTPS terms URL are property fields carried into the shared mail layout. Colour applies only to links/buttons; footer text is escaped. Preview follows draft logo, colour and footer. No domain-contract file change is required for the additional internal brand metadata.

The Hotels directory uses the existing authorized properties list, with shared table controls and a hotel quick peek. The properties GET adds `staffCount` (owners/admins plus unsuspended assigned staff), `pmsSource` (`MUST` or enabled `CLOCK_PMS` assignment), and `connectedProviders` (enabled assignments whose connection status is `CONNECTED`); it returns no credentials. Tenant RLS and owner/admin versus assigned-staff list access are unchanged. A failed Clock connection remains Clock-managed. Active versus Needs setup uses the Settings hub's five required `areaHealth` checks: identity, booking rules, arrival/departure times, payment method and website connection. This directory supplies no cross-hotel booking aggregates. Settings links remain owner/admin-only; Add hotel additionally requires verified email and retains the existing create endpoint and plan cap.

TanStack Query handles dashboard fetch/cache state and TanStack Table handles tables. `packages/ui/src` exports primitives, StatePanel, StatusBadge, shell/navigation and design tokens. ECharts is installed and registered in `dashboard/echart.tsx`; there is no unresolved ECharts-versus-Recharts implementation choice. Source presence does not certify Figma fidelity or accessibility. [Design documentation](../design/design-system.md) separates intended screens from built components.

[next.config.ts](../../apps/web/next.config.ts) proxies `/api/:path*` to `API_URL/:path*` and `/clock-webhooks/:path*` to the API root route. It also configures Sentry and standalone output. This is a reverse-proxy boundary, not a second booking domain.

## WordPress guest application

[Bootstrap](../../apps/wordpress-plugin/must-hotel-booking.php) loads the autoloader, configuration/module loader and updater. `src/Core/Plugin.php` handles activation/upgrades and managed pages. `src/Frontend/`, `frontend/templates/`, `assets/js/` and `src/Elementor/` implement booking dates, accommodation selection, checkout, confirmation and room widgets.

**Actual communication is server-side.** [MustApiClient.php](../../apps/wordpress-plugin/src/Core/MustApiClient.php) uses WordPress HTTP requests to MUST, forwarding idempotency keys and a guest cookie. `must_wp_guest_session` is the first-party WordPress cookie relayed as `must_guest_session` to the API. Guest JS uses WordPress AJAX handlers for availability and confirmation polling. The original ADR wording about direct browser-to-API calls is historical intent, not today's transport. No plugin-scoped API credential is issued.

Pairing redeems a short-lived code at `/wordpress-pairing/redeem` for public tenant/property/API configuration. The platform service stores hashed-code keys in Redis with a 30-minute TTL and GETDEL single use; it does not have the Postgres pairing table proposed by ADR-0027. The plugin has a compiled production default and a local-development override; do not replace a configured target without an operational task.

The release workflow [.github/workflows/wordpress-plugin-release.yml](../../.github/workflows/wordpress-plugin-release.yml) packages allowlisted runtime paths on a plugin version change on main and publishes to the distribution repository. `apps/wordpress-plugin/src/Core/Updater.php` integrates the vendored update checker. A source version is not proof any site installed it.

## Retrofit limits

The guest booking path delegates reservation/payment/PMS authority to the platform, and Plugin removes legacy payment/Clock configuration. However, the checked-in plugin **still loads its legacy installer**:

- `Plugin.activate()` and `maybeUpgradeDatabase()` invoke `apps/wordpress-plugin/src/Database/install-tables.php`.
- That installer contains dbDelta definitions for legacy room/reservation/payment/refund/Clock-accounting tables and integrity helpers.
- Legacy repository/engine classes and assets remain. Their presence is not proof that all are active user flows; their removal requires call-site, hook, upgrade and package analysis.
- The old plugin README, child agent file and plugin-local documentation described the predecessor independent staff portal/domain application. The 15 predecessor documents and their five ADRs are preserved in the [standalone-plugin archive](../archive/wordpress-plugin-pre-retrofit/README.md); the plugin-local index now routes here.
- No Soves tour/staff dashboard runtime was found. The imported "Milestone 20" is preserved as [unverified-origin history](../archive/20-staff-dashboard-redesign-unverified-origin.md), not a platform feature plan.

Do not claim "WordPress stores no local tables" or certify the plugin's declared PHP minimum from documentation. Runtime compatibility and safe upgrade behavior require separate testing.

## API route map

Routes below are relative to the Nest API. Browser requests through Next normally prefix them with `/api`. Inspect each controller for current verbs, input parsing and guards; no complete generated OpenAPI specification is present.

| Surface | Routes / owner |
| --- | --- |
| Auth | `/auth/*`, `auth.controller.ts` |
| Staff/property administration | `/tenants/:tenantId/...`; `tenancy/*controller.ts` |
| Public catalog | `/tenants/:tenantId/properties/:propertyId/public/catalog` |
| Public availability | Same scope + `/public/availability`, `/public/availability-check`, `/public/availability-calendar` |
| Quotes | Same scope + `/quotes`, `/quotes/display-prices` |
| Guest booking/order | Same scope + `/bookings`, `/bookings/orders`; public projection under `/public/bookings/:bookingId` |
| Staff booking/payment actions | `staff-booking.controller.ts`, `manual-payment.controller.ts`, `payment-refund.controller.ts` |
| Staff payment ledger (read-only) | `GET /tenants/:tenantId/properties/:propertyId/payments/bookings/:bookingId`, `payment-ledger.controller.ts`; needs the `payments.refund` capability |
| Gateway callbacks | `stripe-webhook.controller.ts`, `pokpay-webhook.controller.ts`; provider-specific verification |
| Clock SNS | `/clock-webhooks/:webhookPublicId`; no staff session; pinned topic and signature checks |
| Pairing | `/wordpress-pairing/redeem`; staff code-generation controller is tenant/property scoped |
| Platform oversight | `/platform/*`, platform-admin role; targeted operations rather than tenant impersonation |

Shared contracts are handwritten. Many web response types are local to their components; changing an API requires checking PHP, JS, React and tests, not only the TypeScript provider interface.

Physical rooms can have their own ordered photos in `room_images`. The property-wide room routes are `GET /tenants/:tenantId/properties/:propertyId/rooms/:roomId/images`, `POST` on that collection for a presigned upload, `POST /from-url`, `POST /from-library`, `PUT /order`, `PUT /primary`, and `DELETE /:imageId`. Mutations require a verified user with `photos.manage`; tenant, property and room scope are enforced. A room's public/read presentation uses its own images when any exist and otherwise projects its room type's images. In public catalog `rooms[]` entries, `images[]` is the ordered effective gallery and `photoSource` is `room`, `room_type` or `none`; clients should render this projected list directly.

Room-type photos are managed in the tenant dashboard with a dedicated main-image selector and a separate ordered gallery manager. The selector can choose an existing gallery photo or upload one main photo; uploading a main photo also adds it to the gallery. `GET /tenants/:tenantId/properties/:propertyId/room-types/:roomTypeId/images` returns gallery order and an `isPrimary` flag; the first photo is selected as primary when a gallery is first created. Staff can request a presigned upload at the collection route, add an existing public URL at `/images/from-url`, persist a full-gallery order with `PUT /images/order`, select the cover with `PUT /images/primary` and `{ "imageId": "…" }`, or remove one item with `DELETE /images/:imageId`. Removing the primary promotes the first remaining gallery item. A room type holds at most 21 photos (one main plus 20 more), and the dashboard refuses uploads narrower than 1200 px. Photo and photo-library mutations require a verified user holding the `photos.manage` capability; tenant owners and admins have every capability, and staff get it through a property role template or a per-person grant. The API mirrors the selected primary and remaining gallery URLs back to `main_image_url` and `gallery_image_urls` for the existing public catalog and WordPress guest client.

### Accommodation category dashboard contract (2026-10-18)

The existing scoped `/tenants/:tenantId/properties/:propertyId/room-categories` GET/POST and `/:categoryId` PATCH responses include `updatedAt` from the persisted timestamp. Create/rename rejects trimmed case-insensitive duplicate names with HTTP 409; a scoped property row lock serializes concurrent API name checks. Name and description limits remain 200 and 2,000 characters. DELETE clears category assignments without deleting room types or rooms and compacts the remaining order. PUT `/order` requires every category in that property exactly once. Mutations retain `accommodations.manage` and verified-email checks. Dashboard bulk actions and room-type assignment use sequential existing mutations; they are not atomic batches. The public catalog and WordPress contract are unchanged by these category corrections.


### Integration settings and corrective controls (2026-10-22)

Settings > Integrations exposes tenant Clock/PokPay connections, hotel assignment, verification, credential replacement and stored synchronization progress using shared dashboard components. `PATCH /tenants/:tenantId/integration-connections/:id/credentials` tests merged authentication fields before committing an encrypted compare-and-swap update; failed tests preserve working credentials. Host/account/merchant changes require a separate connection. Existing booking/payment history prevents switching or deleting its prior provider connection; changing provider accounts requires a reviewed migration. No secret is returned to the form. Existing verified-email/settings permissions apply.

`GET /tenants/:tenantId/properties/:propertyId/clock-sync/financial/:bookingId` requires payments.view and reads the scoped stored financial projection, queuing an absent projection without making a synchronous provider request. Clock Inventory shows supported saved availability and restrictions; Calendar hides the duplicate availability tab only for Clock hotels. Shared refund choices are reused in cancellation and the refund dialog can open the combined cancellation workflow. Retained email previews use a centered, auto-height script-disabled iframe and one outer dialog scroll. Existing retained content is immutable; richer default wording applies to newly prepared messages, preserving published hotel overrides.


### Corrective controls and guest management (2026-10-23)

Clock Inventory has Overview, Availability, Restrictions, Blocks and Sync health views. The first three use supported stored day projections; Blocks explains the missing full provider block reader and links to sale closures. Sync health is inventory-scoped. Search is 740px with a visible title. Account date format defaults to DD/MM/YYYY, birthday entry follows that preference, and an unset personal timezone inherits the hotel timezone. This is not an application-wide date-format rollout.

Integrations uses category-filtered provider cards and Test, Credentials and Enable/Disable controls. Credential dialogs retain provider-specific fields. PokPay production stays unavailable because the adapter is staging-only; future providers are explicitly Coming soon. Disabling Clock with active future bookings is rejected to avoid silently switching those bookings to standalone inventory. Credential repair remains available. No credentials are returned or replaced by opening a dialog.

`GET/POST /tenants/:tenantId/properties/:propertyId/bookings/:bookingId/manage` are rate-limited, signed guest routes. GET accepts a token and returns scoped safe booking/policy/financial eligibility. POST requires the token, current version, idempotency key, reason and explicit cancel/request action. The public `/booking/manage` page is noindex and suppresses referrers. It shows the deadline in the saved hotel timezone and requires consent before submitting; unknown terms and restricted-period requests remain pending staff review. New confirmations use this page; retained messages remain unchanged. The common email logo is capped at 96px. Payment Copy/QR/Open reuse a short-lived prepared link; clipboard refusal offers a selectable link instead of falsely reporting success.
