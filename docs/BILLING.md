# Platform Billing

This document covers only **platform billing**: the subscription MUST charges tenants (hotels) for using the platform. It does not cover guest room payments (Stripe Checkout/PokPay/pay-at-hotel/Clock folios) — those are a separate domain, carried from `docs/source/clock-pms-integration.pdf` and detailed once the guest-payment work starts. Do not merge the two in code, data model, or ledger.

All decisions below are accepted (2026-07-27) — see `decisions/` for full context, options considered, and consequences on each.

## Plans (ADR-0007)

Flat tiered plans — the shape is confirmed. The table below is an **illustrative example only**, not a final catalog; real tier count/names/limits are confirmed together with the owner at Milestone 8 (Platform Billing) kickoff — see `docs/roadmap/milestones/08-platform-billing.md`.

| Plan | Properties | Staff seats | PMS connections |
| --- | --- | --- | --- |
| **Free** _(illustrative)_ | 1 | 3 | None (local/direct booking only) |
| **Basic** _(illustrative)_ | 3 | 10 | 1 per property (add-on for more — not unlimited) |
| _(further tier(s))_ | TBD | TBD | TBD |

## Enforcement (ADR-0005)

Plan limits are enforced in the API layer at the point of the constrained action (e.g. creating a new property, inviting a new staff seat), not retroactively.

- **Hard limits** — properties and staff seats per tenant: the action is **blocked** once the plan's cap is reached.
- **PMS connections** — a feature gate, not a count: blocked entirely on plans without it, unlimited on plans with it.
- Any future usage-shaped limit (e.g. bookings/month) is classified hard or soft individually when added to the table above.

## Billing provider (ADR-0003)

Stripe Billing (subscriptions, invoicing, customer portal) is the implementation for now, built behind a `BillingProvider` interface (mirrors `PmsProvider` in `ARCHITECTURE.md`) so a second provider — specifically PokPay, for tenants wanting a regional/local payment method for their own subscription — can be added later without a rewrite. PokPay-for-platform-billing is not scheduled; it is added when explicitly requested. This is independent of PokPay's existing role as a guest payment provider.

## Onboarding (ADR-0008)

Self-serve signup, no payment card required upfront. New tenants land directly on the **Free** plan, which is **permanent** (no expiry) — Free and "free trial" are separate concepts. A tenant may separately start an optional, time-boxed **paid-plan trial** (illustrative: 14 days) from the dashboard at any time; if not converted to a paid subscription before it ends, the tenant reverts to Free (not locked, not deleted). Upgrading to a paid plan (or starting a trial) is a self-serve in-app action that invokes Stripe Billing. Which tier(s) offer a trial and the exact trial length are confirmed at Milestone 8 kickoff.

## Data retention after cancellation (ADR-0009)

30-day grace period after cancellation, then hard delete via a scheduled job. Reactivation within the window restores full access. Deletion scope is **tenant data only** — organization, properties, staff/user accounts, operational subscription state. **Invoices, tax records, and payment-transaction records are explicitly excluded** and retained per legal/tax retention policy, independent of this job; security/audit logs follow the security retention policy. Guest/booking/payment history is explicitly out of scope for this rule and follows its own retention policy. Backups expire on their own retention cycle and must not be restored to production without re-applying deletions.

## Explicit non-goals (v1)

- Marketplace/revenue-share billing.
- Multi-currency tenant billing (not scoped in; revisit if ADR-0004's future multi-region expansion brings non-EUR/USD tenants).
- Usage-based billing pipeline (current plans are capacity-based, not usage-metered; revisit only if a future tier requires it — would need a new ADR since it changes the pricing model's shape, not just a table row).
