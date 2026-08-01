# Project Context

## Evidence baseline

- Integration branch inspected: `codex/final-confirmation-integrity-integration`.
- Base commit: `9f591c69419bcc45a050ee26b42a39e094d4d10c`; the integration changes are currently uncommitted.
- Plugin header and version constant: `0.4.92`.
- Evidence date: 2026-07-15.
- Current executable source outranks documentation. Production configuration and database state were not inspected.

## Product purpose

MUST Hotel Booking is a WordPress plugin for hotel sales and operations. It covers accommodation catalogues, physical room inventory, availability, pricing, reservations, guest records, checkout, payments, refunds, email, administration, staff operations, reporting, and optional Clock PMS integration.

## Current scope and status

| Capability | Status | Evidence-based boundary |
| --- | --- | --- |
| Local public booking | Implemented | Managed booking pages, local availability/quote/reservation providers, locks, pricing, coupons, checkout and confirmation exist. |
| Clock-backed public booking | Implemented; certification pending | Online payment uses a local pending mirror, immutable payment ownership/allocation, durable Clock-recovery evidence, an exclusive Clock-fulfillment lease, centralized first-confirmation authorization, and manual-review boundaries for expired, ambiguous, or partial outcomes. Runtime/provider acceptance remains unverified. |
| Stripe | Implemented | Checkout sessions, signed webhooks, return verification, refunds, fee snapshots, and Clock accounting exist. Production configuration is unknown. |
| PokPay | Implemented | SDK order creation/fetch/finalization, embedded/redirect modes, refund attempt/manual fallback, and credential verification exist. Production configuration is unknown. |
| Pay at Hotel | Implemented, opt-in | Disabled by default. Explicit enablement creates pending/unpaid reservations, then the atomic offline owner records the pay-at-hotel row and authorizes confirmation; cash refunds remain manual. |
| On-request booking | Not found as a distinct public mode | Do not equate staff cancellation approval or Pay at Hotel with a separate on-request lifecycle. |
| WordPress admin | Implemented | Reservations, provider logs, calendar, accommodations, pricing, availability, payments, email, guests, coupons, reports and settings. |
| Staff portal | Implemented, configurable | `/staff` and `/staff-login`; nine capability-gated modules. |
| Guest account dashboard | Not found | Guests use the booking, checkout, confirmation and signed cancellation-link surfaces; there is no separate logged-in customer account area. |
| Clock inbound/outbound sync | Implemented with partial external acceptance | SNS inbound, scheduled fallback, catalog/availability sync, amendments and cancellation paths exist; some operations remain manual or unverified externally. |
| Clock accounting | Implemented with manual-review boundaries | Verified deposit-folio payment/refund paths exist; ambiguous targets, accommodation-charge cleanup and cancellation-fee posting remain manual. |
| Elementor | Implemented | Booking search, rooms list and rooms text-grid widgets. |
| Release updater/package | Implemented | Bundled plugin-update-checker, GitHub release contract, and package workflow. |

## Supported booking modes

### Provider mode

- `local`: WordPress data is used for availability, pricing and reservations.
- `clock`: Clock PMS supplies provider-backed availability, quote and reservation behavior; WordPress keeps local mirror/content/payment state.

Clock can be configured to fall back to local behavior when unavailable. That option can create split-brain inventory if enabled during a Clock outage and therefore requires an explicit operational decision.

### Website flow mode

- `plugin_checkout`: managed multi-step plugin booking flow.
- `clock_wbe_inline`: Clock WBE inline mode, which can bypass legacy plugin booking-flow pages.

### Payment mode

- `stripe` and `pokpay`: online, pending until authoritative server verification.
- `pay_at_hotel`: offline, explicit opt-in, confirmed with payment due at the property.

## Users and surfaces

- Guests: `/booking`, `/booking-accommodation`, `/checkout`, `/booking-confirmation`, optional `/rooms`, and cancellation links.
- WordPress administrators: plugin admin menu and hidden detail/create pages.
- Hotel staff: capability-gated `/staff` portal and `/staff-login`.
- External systems: Stripe, PokPay, Clock PMS/AWS SNS, WordPress mail, Elementor, and GitHub releases.

## Domain terminology

| Term | Meaning |
| --- | --- |
| Accommodation / sellable room | Commercial listing stored primarily in `must_rooms`. |
| Room type | Internal/provider-facing inventory category in `mhb_room_types`; may mirror a sellable room. |
| Physical room / inventory unit | Assignable unit in `mhb_rooms`. |
| Reservation | Local row in `must_reservations`; may be local, a pending Clock mirror, or a Clock mirror with provider IDs. |
| Booking ID | Local human-facing `MHB-...` reference; not the same as a Clock booking ID or payment transaction ID. |
| Payment row | Local ledger projection in `must_payments`; distinct from reservation `payment_status`. |
| Pending payment attempt | Immutable attempt-time identity stored on its payment rows: provider reference/mode/credential fingerprint, exact reservation/payment allocation, total/currency, checkout mode, expiry, booking snapshot, site environment, and Clock target when required. |
| Payment verification group | Immutable Stripe/PokPay ownership row bound to provider mode/account, transaction, attempt, exact reservation allocation, total, and currency. |
| Paid-provider observation | Idempotent evidence that the gateway is authoritatively paid while allocation, compatibility, confirmation, or Clock fulfilment remains incomplete; it is not a second payment ledger or confirmation authority. |
| Refund row | Explicit refund/review state in `must_refunds`; cancellation alone is not a refund. |
| Provider mapping | Local/external identity mapping in `mhb_provider_mappings`. |
| Accounting row | Clock payment/refund posting and verification state in `must_clock_folio_accounting`. |
| Quote draft | Signed, session-bound snapshot used to detect tampering/staleness before final creation. |

## Source-of-truth boundaries

- Clock mode: Clock owns Clock identifiers, live availability/restrictions, provider reservation state, and supported provider amendments.
- Website: WordPress owns presentation/content, managed pages, local mirror state, staff UI, and operational metadata.
- Payment providers/local ledger: Stripe/PokPay results establish external truth; immutable verification groups/allocations own local confirmation authority, while payment/refund rows remain ledger projections.
- A Clock booking status, folio balance, browser return, or local reservation flag is not interchangeable with payment proof.

## Current environments

Code supports finite local, staging and production payment credential slots, plus Clock sandbox, production and custom endpoints. Online attempts require an explicitly saved site environment; Clock-backed payment also requires the compatible sandbox/production mode and a human-approved fingerprint of the configured Clock property/account target. Attempt-time gateway credentials and complete target identity are rechecked before verified ownership or Clock creation. The current saved environment, target approval, callback reachability, credentials, API rights, WordPress cron configuration, database version/shape, and theme overrides are **unverified**.

## Current limitations and unresolved risks

1. The confirmation grants, exact pending-attempt binding, environment/Clock-target gate, paid-provider observations, immutable payment ownership, central first-confirmation authorization, repository guard, and fulfillment leases have received static review only; database concurrency and provider behavior are not certified.
2. There is no automatic recovery worker for Clock fulfillment held in `manual_review`; staff must reread Clock before any approved recovery create.
3. Clock checked-in room/type moves, accommodation-charge cleanup, cancellation-fee accounting, and ambiguous financial adjustments remain manual or unsupported.
4. Distribution metadata declares PHP 7.4 support; active payment, email, portal, and quote paths use PHP 7.4-compatible helpers and pass source lint on the available runtime.
5. Public rendering can trigger a PokPay credential authentication probe when saved credential state is unverified; passive requests should not own provider diagnostics.
6. Provider/activity log retention is unspecified, and no durable email retry queue was verified.
7. Production acceptance is not established by repository evidence. Clock sandbox rights/response acceptance, callbacks, cron, database upgrades, and end-to-end payment/refund flows still require approved environment testing.

Detailed evidence and future phases are in `REPOSITORY_CONSOLIDATION_PLAN.md`.

## Current priorities

1. Human-review and certify the integrated confirmation, payment, and Clock fulfillment call paths.
2. Perform approved behavioral database/concurrency coverage for confirmation, callbacks, refunds, inventory and accounting.
3. Certify Clock create/reference persistence, exact credit-item reconciliation, timeout-after-write recovery, and multi-room partial outcomes in a non-production environment.
4. Move provider credential probes out of passive public rendering and define provider/activity retention plus durable email retry ownership.
5. Complete later repository cleanup only after integrity coverage exists.
