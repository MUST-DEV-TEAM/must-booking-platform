# Architecture

## Core principle

Booking, pricing, payment, and PMS-provider domain logic live in this platform's backend, behind a generic provider interface. No PMS vendor (Clock, and later others) is a first-class citizen of the domain model. The WordPress plugin, and any other frontend, is a client of this platform's public API — it holds no provider credentials and no domain logic.

## System diagram

```
Tenant admin/staff web app (Next.js)      WordPress booking widget (thin embed)
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

## Tech stack

- **Backend**: TypeScript, Node.js LTS, NestJS, PostgreSQL, Redis, BullMQ, OpenAPI, runtime request/response validation.
- **Frontend (tenant admin/staff)**: React/Next.js, TypeScript, TanStack Query, React Hook Form.
- **Booking widget (public, embedded in WordPress or any site)**: isolated React bundle / web component; never talks to Clock or holds provider credentials directly — always through the MUST Public API.
- **Infrastructure**: Docker, managed PostgreSQL, managed Redis, object storage, secret manager, centralized logs/metrics/alerts, CI/CD with migration gates. Hosted in the EU (ADR-0004), with region kept as a configuration parameter rather than hardcoded, to allow future multi-region expansion without rearchitecting.

## Repository layout (monorepo)

```
apps/
  api/              NestJS backend: tenancy, auth, booking domain, PMS adapters, platform billing, guest payments
  web/              Next.js tenant admin/staff dashboard
  booking-widget/   embeddable public booking frontend
packages/
  shared-types/     cross-app TypeScript types/contracts
  domain-contracts/ provider interfaces (PmsProvider, PaymentProvider, BillingProvider)
docs/
  decisions/        ADRs
  source/           original briefs (e.g. Clock PMS+ integration PDF)
```

## Tenant isolation

Every domain table, credential, cache key, and queue message carries `tenant_id` (and `hotel_id`/`property_id` beneath it for multi-property tenants). Isolation mechanism (row-level security vs. schema-per-tenant vs. hybrid) is an open decision — see `TENANCY.md` and its ADR.

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

## WordPress plugin's new role

Per the source brief's principle: WordPress is a shell frontend and one-time configuration surface only. It does not store PMS/payment credentials and does not talk to Clock or any provider directly — it calls the MUST Public API, same as the Next.js tenant app.
