# Milestone 25: Native PMS (MUST as the source of truth)

Status: **Planned — tasks defined 2026-10-18. Nothing implemented. Starts after the Milestone 24 Demo Beach Hotel verification.**
Related: [Milestone 24 — Dashboard redesign](24-dashboard-redesign.md) (the screens for these features are designed there; the backend and behavior are here).

## Goal

A hotel can run on MUST alone, with no external PMS. For those hotels MUST is the **source of truth** for rooms, availability, bookings, guests, stays and money. Hotels that keep an external PMS (today: Clock PMS+ for Empire Beach Resort) are unchanged: their website talks to MUST, and MUST talks to Clock.

## Operating model (owner, 2026-10-16)

| Hotel type | Source of truth | Who talks to whom |
| --- | --- | --- |
| Hotel with an external PMS (Empire Beach Resort + Clock) | The external PMS | Hotel website (WordPress plugin) → MUST API → Clock adapter |
| Hotel without an external PMS | **MUST** | Hotel website (WordPress plugin or other client) → MUST API; staff use the MUST dashboard |

Both paths use the same public API. The choice is per property: one active PMS connection per property already exists (`property_integration_connections`, unique active PMS per property); no PMS connection means built-in mode.

## What already exists

The built-in mode is not new. `apps/api/src/booking/local-pms.provider.ts` (`LocalPmsProvider`, ~1,900 lines) implements the same `PmsProvider` contract as the Clock adapter: availability, quotes, booking create/update/cancel, guest matching, payments (Stripe, PokPay, manual, refunds), expiry, and individual-room claims (Milestone 10). Tables: `bookings`, `payments`, `guests`, `rooms`, `room_types`, `room_availability`, `availability_blocks`, `rate_plans`, `rate_rules`, `inventory_units`. Milestones 4, 5 and 10 are recorded completed. This milestone adds the **operational** layer of a PMS on top of that booking engine.

## Minimum scope (owner: "A and B at the minimum")

**A. Front desk**
- Check-in and check-out of a booking, with state and audit trail.
- Assign / change the physical room for a booking (builds on individual-room support).
- Room status board (for example clean, dirty, inspected, out of service) and who changed it.

**B. Money on a stay**
- Folio per stay: room charges, extras / other charges, payments and refunds against it.
- Invoices and receipts generated from the folio.
- A daily close / end-of-day report.

Note: `clock_folios` is Clock-specific mirror data. The native folio is a separate, MUST-owned model; do not repurpose the Clock tables. Guest payments (Milestone 5) and platform billing (Milestone 15) remain separate ledgers; a native folio must not become the subscription ledger.

## Explicitly not included

- **C. Channel manager** (pushing availability/rates to Booking.com and other sites). Listed as an unscheduled idea in the roadmap; not part of this milestone.
- Additional external PMS vendors.
- Housekeeping task assignment/scheduling beyond the room status board.
- Platform billing (Milestone 15).

## Open questions for kickoff

1. **Invoice legal requirements.** Numbering, tax lines, and any local fiscalization rules for invoices/receipts in the markets we serve must be confirmed with the owner/accountant. Do not assume.
2. **Charge catalog.** Are extras free-form line items per stay, or a configurable catalog (items, prices, tax)?
3. **Night audit semantics.** What the daily close locks, and whether closed days can be corrected.
4. **Permissions.** Which capabilities gate check-in/out, room status changes, charging, invoicing and closing (new capability keys vs existing ones).
5. **Coexistence guards.** Behavior when a property switches between built-in mode and an external PMS (data ownership, in-flight bookings).
6. **Public API surface.** What a hotel website needs beyond today's availability / quote / booking endpoints (for example stay status or invoice retrieval), if anything.
7. **Guest registration at check-in.** Which guest identity details (ID or passport, nationality, additional guests) must be recorded at check-in under local rules, how long they are kept, and who may see them. Booking-time forms (Milestone 24, D8) deliberately do not collect identity documents.
8. **Late check-out / early check-in charges.** Guest requests (Milestone 24, D7) are recorded without charging in version one; charging them belongs to the stay folio here.

## Owner decisions (2026-10-18)

- **Two tracks in parallel.** Empire Beach Resort (Clock) is hardened first through the Milestone 24 verification; a new Albanian hotel without a PMS is waiting, so this milestone starts right after that verification, with no fixed go-live date ("working properly first").
- **Invoicing, Phase 1 = reference only.** MUST produces a **stay statement**, not a fiscal invoice: nights, room charges, extras, payments, VAT split, clearly labelled "Not a fiscal invoice". The hotel issues the legal invoice in its own software. This avoids legal risk and works for any hotel regardless of its fiscal software.
- **Invoicing, Phase 2 = Albanian fiscalization adapter (optional, later).** Per-hotel invoicing mode, with the certificate stored encrypted like other integration credentials. Not started until we have the **official** specification and test environment (not found online on 2026-10-18; secondary sources only) and the hotel's accountant confirms what they need. See "Albania notes" below.
- **Extras are free-form charge lines in version one**, designed so a later catalog, minibar, room service and the **Spa/Services module** (named services with photos, description, price, rules, own staff and calendars) plug in without rework. Spa is its own future milestone, not part of this one.

## Albania notes (secondary sources, to be confirmed by the hotel's accountant)

Accommodation VAT is 6% (valid tourism licence), restaurant, bar and spa 20% (separate invoice unless an inseparable package); the room line starts with "Room" and shows nights; municipal tourist tax is per person per night and varies; every fiscal invoice is reported in real time to the tax system (Law 87/2019) and carries an NIVF code and QR; invoices are never deleted, only reversed or replaced. Guest registration (ID, police) requirements were **not found** and remain an open question. The statement must therefore carry VAT per line with a configurable rate, a tourist-tax line, and use reversal lines instead of deletion.

## Tasks

Method: Codex implements with the backend authorisation used for Milestone 24 Inventory (migrations and scoped routes allowed, same standards: tenant/property scoping, forced RLS, capability gates that fail closed, Idempotency-Key and version checks on writes, audit, real concurrency tests); Claude reviews. Everything applies to **MUST-source hotels only**; Clock hotels never see these features and nothing here writes to Clock.

| # | Task | Done when |
| --- | --- | --- |
| N1 | **Stay lifecycle.** Check-in and check-out of a booking as an explicit stay state (arrived, in house, departed, no-show) with audit, undo window rules, and new capability keys (for example `frontdesk.checkin`, `frontdesk.checkout`) added to the catalog and the migration of role templates. Check-in blocked for unpaid-policy violations only as a warning, never silently | State machine unit tests, concurrency test for double check-in, capability tests |
| N2 | **Room assignment.** Assign or change the physical room of a booking at or before check-in (builds on Milestone 10 individual-room claims); conflict and blocked-room checks; reassignment history | Concurrency tests against the existing room locks; no double assignment possible |
| N3 | **Room status board.** Clean, dirty, inspected, out of service per physical room with who/when; check-out sets dirty; out of service is a link to an Inventory manual block (reason Out of service), not a second mechanism | Board screen, history, tests; blocks and status stay consistent |
| N4 | **Stay folio.** Generic charge lines (description, quantity, unit amount in minor units, VAT rate, category, posted by/at, source), corrections only by reversal lines, payments and refunds shown from the existing payments ledger (read, not duplicated), balance due. Not the Clock folio mirror, not the subscription ledger | Rounding rule documented; tests for reversal, VAT split, balance; no float money |
| N5 | **Stay statement (reference only).** Printable/PDF statement from the folio with VAT breakdown, tourist-tax line, "Room, N nights" wording, per-hotel header details, separate numbering prefix that cannot be mistaken for an invoice, and the label "Not a fiscal invoice" | Statement renders for stays with extras, refunds and reversals; wording tested |
| N6 | **Daily close report.** End-of-day totals by payment method, charges posted, arrivals, departures, in-house, outstanding balances. Version one is a report only (no day locking); locking and corrections are an open question | Report matches ledger totals in tests |
| N7 | **Screens.** Front desk (today's arrivals and departures with check-in/out and room assign), room status board, stay detail folio tab, statement view, daily close. Components only, both light themes, empty and error states | Handoff method; browser screenshots on MUST Local Demo Hotel; Clock hotels hide all of it |
| N8 | **Coexistence guards.** A property that connects an external PMS later hides these features and keeps the data read-only; switching rules documented | Tests for both directions; documented in this file |
| F1 | **Fiscalization adapter (Phase 2, not started).** Blocked on the official specification, a test environment and the accountant's answers | Written up here before any code |

## Open questions that remain (defaults used until answered)

1. Invoice legal requirements: Phase 1 avoids them; Phase 2 needs the accountant (which fiscal provider the hotel uses, tourism licence, tourist tax rates).
2. Night audit: version one does not lock days.
3. Guest registration at check-in: not built until the requirements are known; no identity documents are collected.
4. Charge catalog: free-form lines now, catalog later.
