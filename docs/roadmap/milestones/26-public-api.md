# Milestone 26: Public API for hotel websites

Status: **Planned — scoped 2026-10-16. Nothing implemented for this milestone. No task rows yet; define them at kickoff.** Not part of the first dashboard release (see [Milestone 24](24-dashboard-redesign.md), first-release scope).
Related: [Milestone 15](15-platform-billing.md) (paid-plan entitlement), [Milestone 24](24-dashboard-redesign.md) (the Settings area that manages keys), [Milestone 25](25-native-pms.md).

## Goal

A hotel's own website, built by the hotel or its agency, can show rooms, availability and prices and take bookings through MUST **without installing our plugin or using our pages**. The hotel is a separate party who builds its own front end; MUST stays the system of record for inventory, price, payment and confirmation. This is the same model Clock PMS+ uses with us: access is granted by credentials with limited permissions, not by shipping them a theme.

## Owner decisions (2026-10-16)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Timing | **Next release**, after the dashboard (not in the first release) |
| 2 | Customer model | Both kinds of customer exist, but the product is built to **industry standard: the hotel is a separate party who builds its own site against our API**; the WordPress plugin becomes one client of the same API (the reference client), not a special case |
| 3 | Pricing | **Paid-plan feature.** API keys are an entitlement of a paid plan, decided in Milestone 15 |

## What exists today (verified in code, 2026-10-16)

Public endpoints already used by the WordPress plugin (`apps/wordpress-plugin/src/Core/MustApiClient.php`), all under `tenants/{tenantId}/properties/{propertyId}`:

| Purpose | Endpoint |
| --- | --- |
| Rooms, photos, amenities, rate plans, occupancy | `GET .../public/catalog` |
| Availability, availability check, availability calendar | `GET .../public/availability`, `.../public/availability-check`, `.../public/availability-calendar` |
| Price quote and display prices | `POST .../quotes`, `POST .../quotes/display-prices` |
| Create, update and cancel a booking | `POST .../bookings`, `PATCH .../bookings/{id}`, `DELETE .../bookings/{id}` (idempotency key; cancellation token) |
| Read one booking (guest) | `GET .../public/bookings/{id}` |

Protections today: public read and mutation rate limits per caller, server-side inventory holds, payment confirmed only by the provider's signed callback, idempotent creates. **Not present:** API keys, per-key scopes, a caller identity, a version prefix, usage reporting, outbound webhooks for hotels, an API reference, a sandbox. The property stores a public website origin; **no check that uses it was found** (to verify before relying on it).

## Target model

- **Per-hotel API keys, created in the dashboard** (Settings > API & integrations), shown once, stored hashed, revocable, with last-used and usage counts.
- **Two key types** (the Stripe pattern): a **publishable key** safe in browser code (read rooms, availability, quotes; start a booking), and a **secret key** for the hotel's server (booking lookups, reporting, webhook management).
- **Scopes per key** (read catalog, read availability, create bookings, read bookings, manage webhooks) so a key grants only what it needs.
- **Allowed origins** for publishable keys; server keys optionally restricted by IP.
- **Stable versioned paths** (for example `/v1/properties/{id}/rooms`) with the existing endpoints as the implementation; the current unversioned paths keep working for the plugin during migration.
- **Per-key rate limits** and a usage view (calls per day, errors, last use).
- **Outbound signed webhooks** to the hotel: booking confirmed, cancelled, changed; availability changed.
- **Sandbox mode:** a test key that creates fake bookings and never touches live inventory or payments.
- **API reference and changelog** published for developers.
- **Server stays authoritative:** a website can display anything but can never confirm a booking, set a price or mark a payment paid.

## Open questions for kickoff

1. Which plan tiers include keys, and what rate limit and webhook limits per tier (Milestone 15)?
2. Does a publishable key identify the hotel only, or is it also bound to allowed origins as a hard requirement?
3. Guest identity in bookings made through the API (the booking flow today uses a guest session): how a hotel's own checkout page carries that safely.
4. Payment: the hotel's site redirects to our hosted payment or embeds it? Today the provider's hosted flow is used; embedding changes the integration surface.
5. Data protection: what guest data a key can read, and the agreement the hotel accepts when it creates a key.
6. Whether the Clock-style "hotel grants access" flow is also needed in the other direction (hotels connecting their own PMS) — covered by Milestone 25 and the Clock adapter, not here.

## Explicitly not included

- Building websites, themes or pages for hotels that use their own site.
- A channel manager or OTA distribution (Booking.com and others).
- A marketplace or public developer portal beyond the reference documentation.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
