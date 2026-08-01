# ADR-0001: Payment-first Clock fulfillment

- Status: Accepted
- Date: 2026-07-12
- Scope: Clock-backed online booking creation and payment finalization
- Supersedes: Pre-payment Clock reservation creation for the standard online path
- Superseded by: —
- Evidence confidence: Static code review; runtime certification pending

## Context

Clock booking mode previously risked creating a provider reservation before an online payment was authoritative. The payment-first flow now also persists authoritative gateway evidence before the Clock write and uses an exclusive owner-token fulfillment lease.

This ordering is a business-integrity requirement, but it does not by itself make the whole workflow atomic. Provider writes and local commits span different systems.

## Decision

For the standard Stripe or PokPay path in Clock booking mode:

1. Persist traceable pending local reservation and payment state whose immutable payment rows bind the exact reservation/payment allocation, minor-unit total/currency, booking snapshot, checkout mode, expiry, gateway mode/credential fingerprint, explicit site environment, and approved Clock target when required.
2. Treat browser returns, redirects, and payment initiation as non-authoritative.
3. Reuse a pending provider attempt only after every durable identity field still matches; otherwise supersede it without overwriting provider ownership and fail closed or create a new attempt through the authoritative initiation service.
4. Establish payment success through the provider-specific verified completion path and recheck the attempt-time gateway/site/Clock target before ownership or Clock creation.
5. Transactionally claim the provider transaction for one mode/account and exact deterministic reservation allocation, update its bound payment projections, and persist Clock-recovery evidence without confirming the booking or emitting payment/accounting hooks.
6. When the provider is authoritatively paid but a later integrity, persistence, confirmation, or fulfilment boundary fails, upsert one provider/reference observation plus expected/observed allocations and recovery state; this evidence is not a payment ledger or success authorization.
7. Acquire an expiring owner-token lease; only that active owner may issue the Clock create and persist returned identifiers.
8. Treat an active competing callback as `in_progress`; treat expired, ambiguous, persistence-failed, or partial outcomes as manual review requiring Clock reread.
9. After the required provider result is durable and Clock fulfillment has succeeded when required, lock the exact reservation rows and commit first confirmation only through the central immutable authorization policy.
10. Emit payment/accounting and confirmation/email hooks only after that local transaction commits; a concurrent callback observes the committed rows and emits no duplicate events.

Offline and on-request modes retain their separate lifecycle rules. They must not be described as verified online payment flows.

## Alternatives considered

- Create the Clock reservation before redirecting to payment. Rejected for the standard online path because unpaid provider inventory can be created.
- Treat a successful browser return as payment proof. Rejected because return parameters are user-controlled transport state.
- Make the provider and WordPress database one transaction. Not possible across these systems.

## Consequences

### Positive

- Standard online flow does not intentionally allocate Clock inventory before verified payment.
- Pending local records provide correlation for callbacks and support investigation.
- The ordering matches the project's payment-confirmation invariant.

### Negative

- A captured payment can precede failed Clock fulfillment and therefore requires an operational manual-review path.
- Clock success followed by a failed local write remains cross-system ambiguous, but automatic duplicate creation is blocked pending Clock reread.
- Multi-room provider creation is not one atomic operation.

## Implementation constraints

- Verification must bind gateway, transaction/order identity, amount, currency, environment, and intended reservation allocation.
- The site environment is explicit and finite. Gateway credentials are fingerprinted server-side; Clock-backed attempts require the compatible Clock environment and a separately approved configured property/account fingerprint.
- Paid-provider observations are idempotent by provider/mode/account/reference, expose processing/manual/partial/resolved recovery states, and cannot confirm, email, post accounting, or consume coupons/inventory.
- Fulfillment claims are exclusive owner-token leases; a repeated payment reference does not grant ownership.
- Provider-payment ownership and allocations are immutable and unique; confirmation authorization is scoped to the exact reservation, verification group, claim and allocation-set hash.
- The repository rejects direct first-confirmation writes, while already-confirmed idempotent updates remain compatible.
- Payment and confirmation hooks are deferred until authorized confirmation commits.
- Retry must reread provider state before issuing a new create request.
- Provider idempotency must be transmitted when the provider supports it, not only logged locally.
- Ambiguous or partial outcomes require durable recovery/manual-review state; they must not be reported as success.
- Confirmation access and mutation require authorization independent of numeric reservation IDs.

## Verification

- Duplicate, concurrent, late, and wrong-allocation callbacks.
- Captured-payment/Clock-failure recovery.
- Timeout after provider write and retry after local persistence failure.
- Multi-room partial failure and compensation/manual review.
- Anonymous confirmation access and forged return-parameter tests.

## Evidence

- Current `src/Engine/PaymentEngine.php` verified online completion path.
- Current `src/Provider/Clock/ClockReservationProvider.php` fulfillment path.
- Current `src/Database/ReservationRepository.php` durable evidence locking and fulfillment lease columns.
- Commit `1aab2ec` (`v0.4.89`).
- Static payment-first tests under `tests/`; these do not prove database/provider concurrency safety.
