# ADR-0041: Payment accounts: test and live, free switching, each payment keeps its account

Status: Accepted by the owner on 2026-11-12.

## Context

A hotel's PokPay account is a payment connection (ADR-0026) whose keys point at PokPay staging (test) or production (live). Until now every PokPay call used whichever connection the hotel had switched on, and a payment did not record which account took it. Switching a hotel with payment history from live back to test was therefore blocked: a refund of a real payment would have gone to the test account and failed. The owner wants hotels to switch freely between their test and live accounts, keeping both sets of keys, as payment platforms do.

## Decision

- A hotel keeps one connection per PokPay account: typically a test (staging) and a live (production) one. Exactly one PokPay connection is switched on at a time; switching on another switches the current one off and keeps its keys. Switching works in both directions at any time, with a confirmation in the dashboard, and is recorded in the audit log (mode and the account switched from).
- Whether a connection is TEST or LIVE follows from its own keys: the PokPay host, or the Stripe secret key prefix. Anything not clearly a test account counts as LIVE.
- Every payment session records the connection that created the order (`payment_provider_sessions.connection_id`). Payment checks, webhook confirmations, the minute sweep, balance links, the nightly reconciliation and refunds use that connection, whether it is switched on or not. An older session without a recorded connection uses the only PokPay connection the hotel ever had, or else asks each of the hotel's PokPay connections (the one in use first) and records the one that knows the order.
- Moving a hotel to a different live PokPay account works the same way; the old account stays on file and keeps serving refunds of its own payments. Clock connections keep their reviewed-migration rule, because Clock bookings belong to one Clock account.
- Planned step 2 (not in this release): test payments behave exactly like real ones, including in Clock, so tests run end to end. They are labelled instead of being kept apart: `payments.is_test` (set by the database from the order's account), a Test label on payment screens, a TEST note in the Clock payment text, and their own line in Reports, outside the real money totals.

## Consequences

- Deleting a connection is still refused while the hotel has payments with that provider. A deleted connection's unpaid sessions lose their link (`ON DELETE SET NULL (connection_id)`).
- Stripe follows the same rules when it is enabled for real hotels; its sessions are not yet recorded per connection.

## Alternatives considered

- One connection holding both test and live keys with a mode switch: rejected, because the existing per-connection keys, verification and audit already fit two connections and need no new credential shape.
- Keeping test payments out of reports and Clock entirely: rejected by the owner (2026-11-12); tests must flow through Clock like real bookings, with a visible test label.
