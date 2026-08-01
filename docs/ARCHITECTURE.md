# Architecture

## Core principle

Booking, pricing, payment, and PMS-provider domain logic live in this platform's backend, behind a generic provider interface. No PMS vendor (Clock, and later others) is a first-class citizen of the domain model. The WordPress plugin, and any other frontend, is a client of this platform's public API — it holds no provider credentials and no domain logic.

Per ADR-0016, the guest-facing frontend is not a new green-field widget — it is the legacy single-tenant WordPress plugin (`MUST-DEV-TEAM/must-hotel-booking`), imported into this monorepo as `apps/wordpress-plugin` and retrofitted at Milestone 6: its own domain/payment/PMS code is stripped and replaced with calls to the MUST Public API, while its existing UI is kept and given per-tenant configuration.

## System diagram

```
Tenant admin/staff web app (Next.js)      WordPress plugin (retrofitted, ADR-0016)
              |                                          |
              +--------------------+---------------------+
                                   |
                          MUST Public API / BFF
                                   |
                     Tenant & Auth Context (per-request)
                                   |
                          Booking Application Service
                                   |
                 +-----------------+------------------+
                 |                                    |
         Inventory Service                     Pricing Service
                 |                                    |
                 +-----------------+------------------+
                                   |
                          Source of Truth Port
                                   |
                 +-----------------+------------------+
                 |                                    |
          Local Provider                      Clock PMS Adapter  (Mews/Cloudbeds/Opera later)
                                                       |
                                     +-----------------+------------------+
                                     |                 |                  |
                                 PMS API           Base API        Message Channels

                          Platform Billing Service
                     (tenant subscriptions, plans, invoices)
                                   |
                          Stripe Billing (subscriptions)

                          Guest Payment Service
                    (Stripe Checkout / PokPay, per booking)
```

Platform Billing Service and Guest Payment Service are separate services with separate data stores/ledgers even though both may use Stripe as a provider — one uses Stripe Billing (subscriptions), the other Stripe Checkout/PokPay (one-off guest payments). See `BILLING.md` and `PROJECT_CONTEXT.md`.

Each property configures its enabled guest payment methods (Stripe, PokPay, and/or pay at hotel). A non-zero booking must explicitly select a method enabled for that property; a zero-total booking remains `FREE` and needs no gateway.

## Tech stack

- **Backend**: TypeScript, Node.js LTS, NestJS, PostgreSQL, Redis, BullMQ, OpenAPI, runtime request/response validation.
- **Frontend (tenant admin/staff)**: React/Next.js, TypeScript, TanStack Query, React Hook Form.
- **Guest-facing frontend**: the retrofitted legacy WordPress plugin (`apps/wordpress-plugin`, ADR-0016) — its existing PHP/UI stays, its domain/payment/PMS code is replaced with calls to the MUST Public API; never talks to Clock or holds provider credentials directly.
- **Infrastructure**: Docker, managed PostgreSQL, managed Redis, object storage, secret manager, centralized logs/metrics/alerts, CI/CD with migration gates. Hosted in the EU (ADR-0004), with region kept as a configuration parameter rather than hardcoded, to allow future multi-region expansion without rearchitecting.

## Repository layout (monorepo)

```
apps/
  api/              NestJS backend: tenancy, auth, booking domain, PMS adapters, platform billing, guest payments
  web/              Next.js tenant admin/staff dashboard
  wordpress-plugin/ retrofitted legacy guest-facing plugin (ADR-0016), imported at Milestone 6
packages/
  shared-types/     cross-app TypeScript types/contracts
  domain-contracts/ provider interfaces (PmsProvider, PaymentProvider, BillingProvider)
  ui/               versioned design tokens and reusable accessible React UI primitives for apps/web
docs/
  decisions/        ADRs
  source/           original briefs (e.g. Clock PMS+ integration PDF)
```

## Tenant isolation

Every domain table, credential, cache key, and queue message carries `tenant_id` (and `hotel_id`/`property_id` beneath it for multi-property tenants). Isolation mechanism: shared schema + Postgres row-level security (RLS) by default, per ADR-0002 — see `TENANCY.md`.

## Local availability

The local inventory service stores `inventory_units` as a tenant/property/room-type count for each sellable night. Availability is queried over an end-exclusive stay range and is true only when every requested night has a positive local unit count; it has no PMS dependency.

## PMS provider interface

Carried directly from the Clock PMS+ integration brief (`docs/source/clock-pms-integration.pdf`), scoped per tenant/property:

```ts
interface PmsProvider {
  testConnection(context): Promise<Result>;
  syncCatalog(context, cursor?): Promise<Page>;
  getAvailability(context, query): Promise<Result>;
  getBooking(context, externalBookingId): Promise<Booking | null>;
  findBookingByExternalReference(context, reference): Promise<Booking | null>;
  createBooking(context, command): Promise<Result>;
  updateBooking(context, command): Promise<Result>;
  cancelBooking(context, command): Promise<Result>;
}
```

`context` always includes `tenantId` and `propertyId`. `ClockPmsProvider` is the first implementation; `LocalPmsProvider` and future vendors (Mews, Cloudbeds, Opera) implement the same interface without changing the booking domain.

The full Clock-specific architecture (HTTP client, rate limiting, error classification, webhook architecture, booking state machine, idempotency, reconciliation, etc.) from the source brief carries over unchanged in principle and will be materialized as `CLOCK_ARCHITECTURE.md`, `CLOCK_ENDPOINT_MATRIX.md`, and the other deliverables listed in the brief, once the Clock adapter work starts (see `ROADMAP.md`).

## Billing provider interface

Platform billing (tenant subscriptions, per `BILLING.md`) follows the same provider-abstraction pattern as `PmsProvider`, per ADR-0003:

```ts
interface BillingProvider {
  createCustomer(context, tenant): Promise<Result>;
  createSubscription(context, planId): Promise<Result>;
  changePlan(context, subscriptionId, newPlanId): Promise<Result>;
  cancelSubscription(context, subscriptionId): Promise<Result>;
  getSubscription(context, subscriptionId): Promise<Subscription | null>;
  handleWebhook(context, event): Promise<Result>;
}
```

`context` includes `tenantId`. `StripeBillingProvider` is the only implementation for now; a future provider (e.g. PokPay, for tenants wanting a regional/local subscription payment method) can be added later without changing the platform billing domain. This is a distinct interface/implementation from any guest-facing `PaymentProvider` (Stripe Checkout/PokPay for room payments) — same vendor may back both, but the code paths and data models never merge (`PROJECT_CONTEXT.md`).

## WordPress plugin's new role

Per the source brief's principle: WordPress is a shell frontend and one-time configuration surface only. It does not store PMS/payment credentials and does not talk to Clock or any provider directly — it calls the MUST Public API, same as the Next.js tenant app.

Per ADR-0016, this is realized by importing and retrofitting the legacy plugin itself (`apps/wordpress-plugin`) rather than building a separate new widget: its domain/payment/PMS code is removed, its UI stays, and tenant/property configuration (API base URL, tenant ID, property ID, plugin-scoped API credential) is added to its settings screen so each tenant's own WordPress install points at their own tenant in the shared multi-tenant backend.
