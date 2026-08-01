# Changelog

Notable product, architecture, integration, operational, compatibility, and security changes are recorded here. Exact implementation history remains in Git.

## 0.4.92 - 2026-07-17

### Changed

- Hardened Clock/refund idempotency, payment failure state transitions, transactional failure cleanup, PHP 7.4 compatibility, keyboard focus, and configurable cancellation-policy messaging.
- Aligned Clock Digest authentication, HTTPS endpoint containment, API-type configuration validation, shared-worker five-call-per-second throttling, and 429 backoff with the official API contract.
- Removed the undocumented Clock idempotency header; local idempotency remains durable evidence and ambiguous writes now require authoritative reread or manual review.
- Require exact Clock folio credit-item correlation by provider reference, amount, currency, and real item ID; balance-only recovery and synthetic provider IDs are no longer accepted.

- Consolidated repository documentation into the canonical structure routed by `docs/INDEX.md`; no runtime behavior changed.
- Persist authoritative verified-payment evidence before Clock fulfillment, serialize creation with an owner-token lease, and expose truthful blocked/failed lifecycle outcomes.
- Serialize local paid-row and confirmation persistence under exact reservation-row locks, deferring payment/accounting and confirmation/email hooks until commit.
- Record per-room Clock fulfillment and route expired, ambiguous, persistence-failed, or partial outcomes to manual review.
- Centralize every first confirmed-equivalent transition behind immutable flow-specific authorization and reject direct repository bypasses while preserving already-confirmed idempotency.
- Bind each Stripe/PokPay transaction and pending attempt to one environment/account, exact reservation set, per-reservation allocation, amount and currency before Clock fulfillment; paid evidence alone emits no booking-success side effects.
- Reuse pending checkout only when its durable payment-row allocation, booking snapshot, provider mode/credential fingerprint, checkout mode, expiry, explicit site environment and approved Clock target still match; superseded attempts retain their original ownership.
- Fail closed before Clock creation when gateway/site/Clock environments or the approved Clock property/account fingerprint differ from attempt time.
- Persist idempotent provider-paid observations and expected/observed allocations for integrity, local-persistence, confirmation, ambiguous/failed Clock and partial multi-room outcomes without firing payment, accounting, confirmation or email hooks.
- Route public/staff pay-at-hotel, Clock imports and explicit administrative recovery through the same confirmation boundary, with activity-log decisions and post-commit confirmation email.

### Fixed

- Restore Clock exact physical-room availability by requiring parent type/rate sellability from `rates_availability` plus the selected physical room's inclusive-range `room_statuses` evidence across search, final checkout, and paid fulfilment; keep the disabled-date calendar advisory and fail closed on unconfirmed selected-stay evidence.
- Bind Clock-backed payment attempts to versioned exact-room allocation, stay, guest, amount, and physical/type/rate mapping evidence, and stop fulfilment before provider creation when those mappings drift.
- Atomically convert session-owned exact physical-room locks into the complete Clock pending-mirror set, rejecting local overlaps and rolling back every room before payment initiation when conversion fails.
- Distinguish an unconfirmed exact-room Clock availability request from confirmed unavailability, keeping the guest on the calendar with a retry action when provider transport fails.

### Security

- Replace numeric public confirmation/cancellation access with opaque, hashed, expiring reservation-set grants and per-tab cookie-bound contexts.
- Bind PokPay finalize/success handling to the authorized exact reservation set and stored order; failure/cancel returns do not mutate local booking state.
- Bind signed Clock SNS notifications to either the configured exact Topic ARN or complete HTTP Basic credentials.
- Redact access tokens and other sensitive URL/query values from provider diagnostics.

### Database

- Add idempotent public-access grant/context tables and additive Clock fulfillment key, owner, claim, lease, and lease-index schema repair, including equal-version upgrades.
- Add idempotent confirmation flow/claim/source/timestamp columns and immutable payment-verification group/allocation tables with uniqueness repair on fresh and equal-version upgrades.
- Add immutable attempt-identity columns to existing payment rows plus provider-paid observation/allocation evidence tables, with additive fresh-install and equal-version repair and legacy-row defaults.

## 0.4.90 - 2026-07-13

### Fixed

- Made the GitHub release-package workflow produce a Linux-compatible canonical plugin ZIP.

## 0.4.89 - 2026-07-12

### Changed

- Changed Clock-backed Stripe/PokPay checkout to create a local pending-payment mirror first and defer the Clock reservation until server-verified payment.
- Added amount, currency, reservation-set, and stored-payment binding checks around Stripe and PokPay completion.
- Added a local Clock-fulfillment claim and pending-fulfilment state for retryable failures.

### Known limitations

- The release did not add a durable provider-paid outcome ledger before Clock fulfillment, an internal recovery job for stranded fulfillment, or behavioral concurrency coverage for duplicate callbacks.

## 0.4.88 - 2026-07-07

### Added

- Split Clock synchronization into full-catalog, availability/rate, and reservation-fallback schedules with separate diagnostics and repair controls.

## 0.4.87 - 2026-07-06

### Added

- Added configurable public date-picker and stored price-breakdown display modes.
- Added bidirectional website/Clock booking-reference metadata and retry diagnostics.

### Changed

- Disabled Pay at Hotel by default and blocked public checkout when no explicitly allowed payment method is configured.

## 0.4.86 - 2026-06-24

### Fixed

- Hardened Clock deposit verification for signed raw folio balances, normalized held amounts, credit-item evidence, and standard-folio isolation.

## 0.4.85 - 2026-06-23

### Added

- Added signed server-side quote drafts, bounded performance diagnostics, and short caches for intermediate Clock reads.

### Fixed

- Required uncached final Clock availability, price, and guarantee-policy validation before reservation creation.
- Bounded provider-sync work per WP-Cron slice.

## 0.4.83 - 2026-06-22

### Fixed

- Hardened PokPay credential diagnostics, provider-data redaction, Clock rate limiting, and deposit-folio idempotency/isolation handling.

## 0.4.82 - 2026-06-18

### Added

- Added shared reservation amendment services for local and supported Clock pre-arrival changes.
- Added cancellation-time financial snapshots and explicit manual-review boundaries.

### Fixed

- Hardened Clock SNS inbound retry/deduplication and routed provider status changes through the local lifecycle service.

## 0.4.81 - 2026-06-14

### Added

- Added Clock PMS Amazon SNS webhook handling and broader payment/refund/cancellation duplicate-event protections.

## 0.4.76 - 2026-06-12

### Added

- Added provider-fee snapshots, default refund breakdowns, customer cancellation policy handling, and equal-version payment/refund schema repair.

## 0.4.74 - 2026-06-11

### Added

- Added the first Codex knowledge base and provider/payment accounting hardening documentation.

## 0.4.5 - 2026-05-18

### Added

- Added PokPay SDK payment-method integration.

## 0.4.0 - 2026-04-19

### Added

- Introduced provider contracts, local adapters, Clock PMS availability/quote/reservation/sync/accounting services, mappings, request logs, and provider job infrastructure.

## Initial development - 2026-03-12 to 2026-03-27

### Added

- Established the WordPress plugin, frontend booking flow, Stripe environment support, inventory/availability services, admin reservation/payment/report services, staff portal, and Elementor widgets.
