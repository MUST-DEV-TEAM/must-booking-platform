# Milestone 25: Native PMS (MUST as the source of truth)

Status: **Planned — scoped 2026-10-16. Nothing implemented for this milestone. No task rows yet; define them at kickoff.**
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

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
