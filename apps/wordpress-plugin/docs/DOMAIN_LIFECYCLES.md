# Domain Lifecycles

This document describes the `0.4.92` release-candidate working tree based on commit `b0380ad`. It separates verified implementation from intended invariants and known defects. Source code remains authoritative when behavior changes.

## Authorities and identifiers

| Concern | Authority in local mode | Authority in Clock mode | Traceability |
|---|---|---|---|
| Website content and presentation | WordPress/plugin database | WordPress/plugin database | Local accommodation, room, page, and media IDs |
| Search inventory and restrictions | Local rooms, reservations, restrictions, and locks | Clock live availability/restrictions; local data is a cache/mirror | Local room/accommodation IDs plus Clock room-type/room IDs |
| Final price and availability | Local pricing and availability engines | Fresh Clock quote/availability result | Signed quote draft, selected room/rate plan, local reservation IDs |
| Reservation state | Local reservation lifecycle | Clock provider state mirrored through local lifecycle services | Local reservation ID, provider booking/reservation IDs, website reference |
| Payment/refund state | Gateway plus local payment/refund ledger | Same; Clock folio state is downstream accounting | Payment/refund row, gateway order/session/intent/refund references |
| Clock money representation | Not applicable | Clock folio and credit-item records | Local accounting row, folio ID, credit-item ID, correlation/idempotency data |

Reservation status, reservation `payment_status`, payment-row status, refund status, provider sync state, and Clock balance are distinct values. A plausible value in one system is not proof of another.

## Reservation states

| State | Inventory | Meaning and normal entry |
|---|---|---|
| `pending` | Blocks | Local/provider workflow has started but is not confirmed. |
| `pending_payment` | Blocks | Online checkout has pending local reservations and payment attempt. |
| `confirmed` | Blocks | Reservation is accepted. Online Clock confirmation is guarded by provider IDs and a paid transaction row. |
| `completed` | Blocks in the shared status policy | Stay was completed by an authorized operational action. |
| `blocked` | Blocks | Operational inventory block, not a paid guest reservation. |
| `payment_failed` | Releases | Authoritative payment failure path marked the attempt failed. |
| `expired` | Releases | Payment/session expiration was established. |
| `cancelled` | Releases | Cancellation lifecycle completed locally or was mirrored from the provider. |

The inventory policy is implemented by `ReservationStatus`. Do not invent a transition by updating a repository row directly; use the lifecycle/status services so hooks and side effects run.

## Search, availability, and selection

### Entry

A public search supplies check-in, check-out, and party size through managed booking pages or Elementor host widgets. Input is sanitized and validated before a selection is stored.

### Current flow

1. `AvailabilityEngine` routes availability to the configured provider adapters.
2. Local mode evaluates active/bookable rooms, restrictions, blocking reservations, and temporary locks.
3. Clock mode reads provider availability/product data. Intermediate reads may use a bounded cache.
4. The guest selects one or more rooms/rate plans. Selection and guest draft data are session-bound transient state; selected rooms receive temporary locks.
5. Continuing to checkout validates the guest form, creates/refreshes the quote preview, and rechecks locks.

### Integrity rules

- Invalid dates, insufficient capacity, expired locks, inactive rooms, and blocking reservations stop the flow.
- Unavailable dates must remain unavailable throughout range selection; UI appearance is not an availability authority.
- A lock reduces race exposure but is not a substitute for final availability validation.
- In Clock exact-room mode, `rates_availability` proves parent-type/rate sellability through `room_types[]`, while `room_statuses` separately proves that the exact mapped physical room is available for the complete occupied-night range. Neither source can substitute for the other.
- A physical selection must have Clock physical-room, accommodation/type, and applicable rate mappings whose parent IDs agree. Missing, ambiguous, malformed, or mismatched evidence is provider-unconfirmed and fails closed without substituting another room of the same type.
- The long disabled-date calendar is advisory: it combines type/rate daily data with local exact-room conflicts and does not precompute Clock physical-room status. Every selected range must still pass `room_statuses` before continuation or a write boundary.
- For deferred Clock payment checkout, the current session's unexpired exact physical-room locks are converted to all pending local mirrors in one database transaction. Physical-room mutexes serialize competing sessions; any overlapping blocking reservation, expired/missing/wrong-owner lock, insert error, or commit error rolls back the complete room set before payment initiation.
- `fallback_to_local_when_clock_unavailable` is configurable but normally false. Enabling it can split provider ownership and must be treated as an explicit operational risk.

### Resolved integrity issue

`ReservationEngine::createReservations()` now resolves `$selectedRatePlanMap` before final pricing and reservation assembly. The selected rate plan is therefore retained from checkout through local creation.

## Quote and final revalidation

### Entry

Checkout has a valid selection, guest form, currency, and calculated room items.

### Current flow

- `BookingQuoteDraft` stores a signed, expiring draft of reviewed pricing and policy data.
- Intermediate Clock quote reads may be cached briefly.
- The final Clock boundary requests fresh type/rate availability, exact physical-room status, price, guarantee information, and cancellation policy with caches bypassed. The selected local rate plan must map to the parent type, and the exact physical-room row must be `available=true` for the inclusive occupied-night range.
- A changed total, currency, or required guarantee stops before payment/provider writes and requires guest review.

### Forbidden transitions

- Do not accept a stale search result as final availability.
- Do not create a payment/provider reservation after a final mismatch.
- Do not treat draft signature validity as proof that provider facts remain current.

### Policy revalidation

The final comparison also checks the room-specific cancellation-policy snapshot. A policy mismatch stops the flow before any reservation or payment write and requires guest review.

See [ADR-0002](decisions/ADR-0002-final-live-quote-revalidation.md).

## Booking creation by payment path

| Path | Local creation | Authoritative confirmation | Side effects | Important boundary |
|---|---|---|---|---|
| Stripe | `pending_payment` / payment `pending` | Stripe session reread is `complete` and `paid`, metadata/reservation set, amount, and currency match | Provider fulfillment when required, paid row, confirmed status, hooks/email/accounting work | Redirect parameters alone are not proof. |
| PokPay | `pending_payment` / payment `pending` | PokPay order reread is captured/paid/completed and order binding, amount, and currency match | Same high-level completion path | Browser return and webhook body are correlated to a provider reread. |
| Pay at hotel | `pending` / `unpaid` when explicitly enabled | Atomic offline service records the exact pay-at-hotel row and receives central authorization | Post-commit payment/confirmation hooks, email and inventory block | It is not an online verified-payment flow or a generic bypass. |
| Admin/staff quick booking | Uses capability/nonce-protected operational flow; Clock mode has provider readiness requirements | Authorized command plus provider result when Clock owns the reservation | Reservation/activity/email/provider side effects | Must not bypass provider/lifecycle policy. |
| Separate on-request public mode | Not found as a distinct current booking mode | Not applicable | Not applicable | Do not document aspirational on-request behavior as implemented. |

### Online payment initiation

1. Create pending reservation records and compute the server-owned target identity from the explicit site environment, gateway credentials, exact reservation totals/snapshot, and approved Clock property/account when required. Clock mode atomically consumes the current session's exact physical-room locks while creating the complete pending mirror set; failure returns no reservation allocation and does not initiate payment.
2. Create a Stripe Checkout Session or PokPay SDK order, then store its immutable attempt identity and exact payment-row allocation on new payment rows.
3. Redirect only to an allowlisted HTTPS provider host.
4. Keep inventory blocked while the attempt is pending.
5. Expiration/failure moves reservations to `expired` or `payment_failed` and releases inventory.

A pending attempt is reusable only when its durable reference, provider/mode/credential fingerprint, checkout mode, unexpired deadline, reservation/payment allocation, minor-unit total, currency, booking snapshot, site environment, and Clock target still match. The versioned exact-room booking snapshot binds each reservation's type and assigned physical-room IDs, rate-plan ID, dates, guests, minor-unit total, and normalized Clock physical-room, accommodation/type, and rate external IDs. Unrelated provider diagnostics are excluded. A mismatch supersedes the attempt without overwriting its provider ownership; only an otherwise unchanged pending reservation set may start a new authoritative attempt. Legacy or incomplete unpaid attempts must restart, while paid legacy or incomplete evidence fails closed into review.

Pending-payment cleanup runs through WP-Cron and a bounded age threshold. A Clock-backed `pending_fulfilment` row may resume only when its complete immutable verification group, paid/verified attempt, unchanged pending reservation state, no refund, and current approved target all still match; it then uses the normal Clock lease and confirmation owners without a payment-provider reread or correlation search. Rows with active/expired/ambiguous/manual Clock fulfillment are not ordinary expired checkout attempts; manual-review outcomes require explicit reconciliation.

## Verified online completion and Clock fulfillment

Current Clock mode follows payment-first ordering:

```mermaid
flowchart LR
    A["Exact pending attempt and allocation"] --> B["Provider payment reread, attempt and target checks"]
    B -->|"not authoritative"| C["Remain pending or fail/expire"]
    B -->|"verified paid"| D["Claim provider payment and exact allocation"]
    D --> E["Persist paid projection without success hooks"]
    E --> J["Acquire owner-token lease"]
    J --> H["Create and persist Clock identifiers"]
    H --> I["Lock exact reservation set"]
    I --> F["Authorize and commit first confirmation"]
    F --> G["Emit payment and confirmation hooks"]
```

Every first transition to a confirmed-equivalent state is owned by `ReservationConfirmationService` and an immutable, reservation-scoped authorization. `ReservationRepository` rejects direct first-confirmation writes, including generic status updates; already-confirmed idempotent updates remain allowed. Online authorization requires the matching immutable verification group/allocation, while offline, provider-sync and administrative recovery use finite explicit flows.

### Idempotency present

- Gateway callbacks reread provider state and validate reservation binding, amount, and currency.
- Verified completion rechecks the attempt-time provider mode/credential fingerprint, explicit site environment, Clock environment, and approved Clock target before durable ownership or any Clock create.
- Paid Clock fulfillment rechecks fresh exact-room availability and requires the current physical-room, accommodation/type, and rate external mappings to match all three saved attempt-time snapshots before any Clock create.
- Existing paid payment/confirmed reservation state short-circuits repeated completion.
- One provider transaction is uniquely owned by one environment/account and exact deterministic allocation; the same pending payment row cannot be allocated to another group.
- Clock fulfillment uses an atomic owner-token lease; a second callback receives `in_progress` and cannot create.
- Matching verified-payment evidence is idempotent and cannot overwrite an active claim or synced provider state.
- Exact reservation-row locks serialize ownership/allocation and later confirmation persistence; hooks are deferred until the authorized confirmation transaction commits.
- Provider request, sync job, and accounting repositories store correlation/idempotency information.

### Recovery and atomicity boundaries

- Authoritative gateway evidence is stored as an immutable ownership/allocation group and, for Clock recovery, in reservation provider metadata before any Clock write. Paid evidence alone does not confirm, show success, consume confirmation side effects, or emit payment/accounting hooks.
- If authoritative paid status is known but attempt/allocation/amount/currency/target compatibility, local persistence, confirmation, or Clock fulfilment fails, one idempotent paid-provider observation records the paid facts and recovery state. Replays update that evidence; it emits no payment/confirmation hooks and is marked resolved only after full completion.
- Only the active lease owner can reach the Clock create boundary or persist returned Clock identifiers.
- Clock creation retains both dimensions: `arrival_room_type_id` comes from the saved-matching accommodation/type mapping and `arrival_room_id` from the saved-matching physical-room mapping. A different returned physical-room ID is failure, never substitution.
- Expired leases, ambiguous provider responses, and local persistence failures enter `manual_review`; another create is forbidden until Clock is reread and reconciled. The only exception is an explicitly authorized internal first-time recovery that proves the deterministic create key has no request log, the exact persisted physical room and mapping still match, and all paid-attempt/allocation/target checks still pass; it reacquires a dedicated manual-review lease before the normal provider create path.
- If a Clock reconciliation write succeeds but its requested local lifecycle transition is blocked, the operation returns failure, stores `manual_review`, and does not present the reservation set as fully confirmed.
- Clock create requests persist and log a local idempotency key. Clock does not document a provider idempotency header, so ambiguous outcomes require authoritative reread and manual review rather than blind replay.
- Multi-room Clock creation is not one provider transaction. Each completed room is recorded, and any partial group is reported as partial manual review rather than complete success.
- No runtime or provider certification is established by this integration review.

See [ADR-0001](decisions/ADR-0001-payment-first-clock-fulfillment.md).

## Confirmation page and guest cancellation

The confirmation page displays booking, stay, guest, payment, and cancellation information and can process Stripe/PokPay returns. Public links use opaque, hashed, expiring grants scoped to an exact reservation set. URL grants are exchanged for per-tab selectors backed by secure HttpOnly cookies; numeric reservation/booking query arguments are not authorization.

Cancellation review and execution use separate purposes. The execution grant is short-lived and atomically consumed before mutation. PokPay success/finalize paths derive the reservation set from the authorized grant and require the stored SDK-order binding; failure/cancel returns are informational and do not change booking/payment state.

## Admin and staff transitions

- Admin and staff handlers use nonces and capability/portal permission checks for their defined actions.
- Provider-backed manual payment actions are rejected by the dedicated admin payment path. Staff/admin recovery must use an explicit authorized flow; it cannot reclassify a known online flow as offline or bypass provider evidence.
- Staff front desk cancellation can enter an approval queue; authorized approval performs the cancellation lifecycle.
- Check-in/check-out/completion, room moves, payment recording, and housekeeping actions remain separate permissions and states.

`BookingStatusEngine` reports updated, already-applied, blocked, and failed IDs. `BookingLifecycleSyncService` routes Clock-import first confirmation through the central provider-sync command, rereads the row, and returns failure when a requested transition was not persisted. Confirmation email is dispatched only from the committed confirmation hook; reservation creation is not an email trigger.

## Cancellation lifecycle

### Entry

Guest token action, authorized admin/staff action, or Clock-originated status change requests cancellation.

### Current flow

1. Validate access, current state, policy, and provider action rules.
2. Capture cancellation-time financial/provider metadata.
3. Request Clock cancellation when Clock owns the reservation; reread must confirm provider cancellation before final local success.
4. Route local status through lifecycle services and emit `must_hotel_booking/reservation_cancelled` once on the transition.
5. Release local inventory because `cancelled` is non-blocking.
6. Calculate/refine refund eligibility separately from cancellation.
7. Queue or record Clock payment/accounting cleanup separately.

### Forbidden transitions

- Cancellation does not prove a gateway refund.
- Clock cancellation does not authorize an automatic refund amount.
- Refund success does not prove Clock accommodation charges were cleaned up.
- A Clock `429` may enter bounded retry. Other failed or ambiguous write outcomes require authoritative reread and otherwise remain manual-review states; they are not blind-replay permission.

## Refund lifecycle

1. Resolve the original paid transaction, provider fee snapshot, already-refunded amount, currency, and remaining refundable amount.
2. Default refund amount is paid amount minus provider fee and cancellation fee, never below zero; unknown fee can require review.
3. Create/update a local refund attempt.
4. Stripe uses a provider refund operation with an idempotency key. PokPay uses the merchant SDK-order refund path and may fall back to manual dashboard handling.
5. Only authoritative provider completion marks the refund completed.
6. Clock negative credit-item accounting is a separate operation and can retry or require manual review.

Refund creation now claims the reservation/provider/reference/amount tuple under a MySQL advisory lock before any gateway call. Stripe and PokPay both receive the deterministic local idempotency key; failed rows may be retried only after the claim is released.

## Amendments

`ReservationAmendmentService` is the supported boundary for local room moves and local/Clock accommodation, room, rate, or date changes.

- Local moves acquire a destination lock, recheck conflicts, and attempt an atomic update.
- Clock amendments use provider reread, documented update, and reread; checked-in room/type moves remain blocked.
- Repricing occurs for material accommodation/date/rate changes.
- Increased totals become `additional_payment_review_required`; reduced totals become `refund_or_credit_review_required`.
- No automatic financial settlement is authorized for amendment deltas.

## Clock synchronization

- Inbound Clock/SNS delivery validates the configured path and message authenticity rules, deduplicates event IDs, and acknowledges success only after durable handling.
- Status-specific events may apply a safe lifecycle transition while queuing a detail refresh; detail-only events need a successful provider fetch.
- Catalog, availability/rate, and reservation-fallback schedules are distinct. Webhooks are preferred; fallback polling and provider-sync jobs repair eventual consistency.
- Sync jobs have pending/retryable/exhausted states, bounded batches, attempts, locks, and diagnostics.

Direct repository status writes are forbidden for provider lifecycle changes because they can skip hooks, email, inventory, refund-review, and cleanup behavior.

## Clock folio accounting and reconciliation

Eligible website payments use an open deposit folio. The standard folio is snapshotted and must remain unchanged. Verification uses signed raw balance movement plus normalized held amount. Refund accounting is negative and separate from the gateway refund.

Automatic accommodation-charge cleanup and cancellation-fee posting remain manual because the plugin cannot durably prove charge-level ownership and targeting. Reconciliation requires an exact credit-item match by provider reference, amount, currency, and real Clock item ID; it does not invent an ID from a local key or accept balance alone when unrelated entries could explain it.

See [ADR-0003](decisions/ADR-0003-clock-deposit-and-manual-accounting-boundaries.md).

## Correlation, logging, and notifications

Trace a case with the local reservation/payment/refund/accounting IDs, booking reference, provider booking/reservation ID, gateway order/session/transaction/refund ID, folio/credit-item ID, sync job ID, event ID, correlation ID, and idempotency key. Never expose secrets or personal data while correlating.

Provider logs and activity records exist and sanitize many payload fields. A documented retention/pruning policy was not found. Email failures are logged, but no durable email retry queue was verified.

## Integrity stop conditions

Stop automation and require investigation when:

- payment is captured but the local paid/confirmed state is absent;
- Clock write success is possible but no durable external ID was stored;
- a multi-room operation is partially fulfilled;
- reservation, amount, currency, environment, account, or transaction binding differs;
- a refund/accounting retry lacks exact original provider identity;
- final price, availability, guarantee, or cancellation policy differs from what the guest reviewed;
- confirmation or cancellation access cannot be proven;
- provider and local ownership disagree and fallback behavior is enabled.
