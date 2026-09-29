# Product overview

Status: **IMPLEMENTED / PARTIALLY IMPLEMENTED**, by area below. Code inspected 2026-09-19.

MUST Booking is a multi-tenant hotel sales and operations platform. An Organization is the business/tenant and owns one or more Properties. Guests browse and book through a WordPress installation; staff work in the Next.js tenant dashboard; MUST administrators use the separate platform route tree in the same web application.

## Current scope

| Area | State | Source / boundary |
| --- | --- | --- |
| Signup, email verification, login, staff membership, property capabilities | IMPLEMENTED | API `auth/`, `tenancy/`; [data and access](architecture/data-and-access.md) |
| Property, room type, physical room, amenities, local rates and blocks | IMPLEMENTED | API `tenancy/`; three property booking modes |
| Signed quotes, single and multi-room reservations, cancellation | IMPLEMENTED | API `booking/`; [domain flows](architecture/booking-and-payments.md) |
| Guest Stripe/PokPay checkout, pay-at-hotel, manual settlement, refunds | IMPLEMENTED | API `payments/`; tenant-owned connections |
| Clock catalog, live pricing/availability, paid booking attachment, webhooks and checks | PARTIALLY IMPLEMENTED relative to original brief | [Clock architecture](integrations/clock/architecture.md); substantial working paths plus explicit reliability/contract gaps |
| Staff bookings, calendar, payments, guests, staff, reports and settings | IMPLEMENTED with placeholders | [frontends](architecture/frontends-and-api.md); Inventory, Approvals and System Health are not full operational products |
| Guest WordPress UI and Elementor widgets | IMPLEMENTED retrofit with LEGACY residue | Server-side MUST API client; retained installer/repositories mean the plugin is not literally free of local tables |
| Platform administration | IMPLEMENTED | API `platform/`, web `app/platform/`; oversight and specific tenant operations |
| Platform subscription billing | PLANNED beyond Free-plan foundation | No Stripe Billing implementation or subscription ledger; [billing](architecture/platform-billing.md) |
| Direct Booking.com/OTA channel adapter | NOT IMPLEMENTED in this repository | Clock can supply externally originated reservations; that is not a direct OTA integration |
| Complete production hardening, metrics, compliance and all Figma screens | NOT VERIFIED / PARTLY PLANNED | Milestone 14 and design gaps; source code presence does not prove deployment acceptance |

## Financial boundary

Guest payments are hotel booking charges and refunds in the `payments` ledger. Clock folios are an external accounting projection. Platform billing is MUST's future subscription revenue from the tenant. These are separate domains; do not reuse the guest ledger for subscription invoices, or treat a Clock folio balance as proof that MUST collected a payment. No settlement/payout ledger was found.

## Origin and retained history

The platform replaces domain/payment/PMS logic formerly embedded in a single-tenant WordPress plugin. [ADR-0016](decisions/ADR-0016-guest-frontend-is-retrofitted-legacy-plugin.md) chose to retrofit that plugin instead of building a separate widget. The retrofit is present under `apps/wordpress-plugin`; staff operations belong to `apps/web`, while legacy plugin tables and helper code remain and need usage analysis before removal.

The old "no application code exists" status was an inception statement, not current truth. Milestone history is preserved in [completed work](roadmap/completed/README.md); work ordering and review gaps belong only in the [roadmap](roadmap/README.md). The production-host record belongs in [operations](operations/README.md), with its verification limits.
