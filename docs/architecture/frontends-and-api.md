# Frontends and API boundaries

Status: **IMPLEMENTED**, with named placeholders and legacy residue. Code inspected 2026-09-19.

## Next.js staff and platform app

[Web app](../../apps/web/app) uses Next App Router. Auth screens share `auth-shell.tsx` and `auth-routing.tsx`. A platform user routes to `/platform`; tenant users use `/dashboard` as membership picker and `/dashboard/[tenantId]` with `propertyId`, `section`, `tab` and `settingsArea` query parameters. Tenant selection is not server-side session state.

`dashboard/dashboard-shell.tsx` owns role/capability-filtered navigation and the shared shell. Hotels and property selection are present; integrations are reachable under Settings, and Quick Booking hosts walk-in creation. Settings is a hub/subview structure; notifications include an inbox. Inventory, Approvals and System Health still render explicit unavailable states. The old separate `main-dashboard.tsx` is absent.

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
| Gateway callbacks | `stripe-webhook.controller.ts`, `pokpay-webhook.controller.ts`; provider-specific verification |
| Clock SNS | `/clock-webhooks/:webhookPublicId`; no staff session; pinned topic and signature checks |
| Pairing | `/wordpress-pairing/redeem`; staff code-generation controller is tenant/property scoped |
| Platform oversight | `/platform/*`, platform-admin role; targeted operations rather than tenant impersonation |

Shared contracts are handwritten. Many web response types are local to their components; changing an API requires checking PHP, JS, React and tests, not only the TypeScript provider interface.

Room-type photos are managed in the tenant dashboard with a dedicated main-image selector and a separate ordered gallery manager. The selector can choose an existing gallery photo or upload one main photo; uploading a main photo also adds it to the gallery. `GET /tenants/:tenantId/properties/:propertyId/room-types/:roomTypeId/images` returns gallery order and an `isPrimary` flag; the first photo is selected as primary when a gallery is first created. Staff can request a presigned upload at the collection route, add an existing public URL at `/images/from-url`, persist a full-gallery order with `PUT /images/order`, select the cover with `PUT /images/primary` and `{ "imageId": "…" }`, or remove one item with `DELETE /images/:imageId`. Removing the primary promotes the first remaining gallery item. Mutations require a verified tenant owner or admin. The API mirrors the selected primary and remaining gallery URLs back to `main_image_url` and `gallery_image_urls` for the existing public catalog and WordPress guest client.
