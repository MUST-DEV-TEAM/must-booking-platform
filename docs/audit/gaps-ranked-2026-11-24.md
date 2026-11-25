# Gaps ranked for closing (2026-11-24)

Reviewed from `hardening-gaps-log.md` (titles, statuses, notes) after G-97 part 1 merged (PR #588). Spot-checked against the code on this date: G-44 (balance links are PokPay only), G-45 (no deposit or prepayment code), G-64 (the API does not check a verified email), G-93 (no append-only protection on `audit_logs`). All four are still open. The rest are ranked from the log text and **not re-verified** against code; each batch starts by re-checking its gaps.

Log hygiene: some ids are used twice (G-30 to G-39 appear in both the money section and the build section), and several rows have run together. Fix this first so references stay unambiguous.

## Batch 1 - money and guest harm (do first)

| Gap | In plain words |
| --- | --- |
| G-46 | **Fixed 2026-11-24.** A payment method showed as available from a switch alone, not a working connection. A guest can pick Stripe on a hotel whose Stripe is not set up. |
| G-45 | Guest checkout always charges the full total; deposit or "first night now" cannot work. |
| G-44 | Staff "pay your balance" links work only with PokPay, not Stripe. |
| G-47 | Multi-room orders cannot get a payment link. |
| G-52 | Three different sources for the free-cancellation window (partly addressed by a database trigger, 2026-11-23). |
| G-77 | Hotels could switch off guest confirmation and refund emails (partly addressed 2026-11-23). |
| G-02 | The guest is never told about a refund that was not made, is pending, or has a cash part. |
| G-03, G-04 | Cash plus card refunds only work in the simplest case; the Clock-cancel path ignores the split. |
| G-05 | Possible error shown for a booking that is already cancelled. |
| G-33, G-40 | Refund edge cases: fee unreadable, or Stripe holds the refund for approval. |
| G-43 | Refund on an already-invoiced booking may be refused by Clock. |
| G-95 | Retry blocked by a guest's own abandoned attempt (in review). |

## Batch 2 - needed before the next hotel goes live

| Gap | In plain words |
| --- | --- |
| G-100 | Bookings do not yet follow the Payment methods settings. |
| G-50, G-51 | No card guarantee for pay-at-hotel; no default when two methods are on. |
| G-54, G-55, G-56 | No-show rule, check-in/out times and terms are saved but not used or shown to guests. |
| G-57, G-61, G-62, G-64 | Rules enforced only in the browser (currency lock, phone, min/max stay, unverified email). |
| G-68, G-90 | Payment keys protected only by the general settings permission. |
| G-85, G-87 | Staff invitations cannot be listed or withdrawn; the owner cannot be changed. |
| G-93 | Audit log can be edited or deleted in the database. |
| G-34, G-41, G-42 | Stripe plus PokPay together, and hotel-specific Clock rights, not yet tested for real. |
| G-96, G-99 | Delivered email may be unseen; reminder timing setting. |

## Batch 3 - Clock and operations (Empire)

| Gap | In plain words |
| --- | --- |
| G-09 to G-13 | Clock live updates for older connections; setup untested on a real new connection; 928 dead-letter jobs. |
| G-06 to G-08 | Review queue: duplicate keys, 456 items with no reference, Luxury's 32 items. |
| G-29, G-30, G-31, G-35, G-36 | Repeating or stuck Clock bill notes and webhook retry steps. |
| G-14, G-39 | Multi-room orders: no "Booking created" notice; quote check misses rate and promo. |

## Batch 4 - tests and tooling (low risk, quick)

G-15 (Clock staging check depends on an expired trial), G-16, G-17, G-18, G-19, G-27, G-38, G-104 (flaky tests and local-run problems), G-20, G-21 (stray log lines and garbled characters).

## Park (nice to have)

G-48, G-53, G-58, G-59, G-60, G-63, G-65, G-66, G-67, G-69 to G-84, G-88, G-89, G-94, G-98, G-101, G-102, G-103, G-32, G-01, G-23, G-24.

## Already done or no action

G-22, G-25, G-26, G-35 (settings form), G-37, G-39 (Stripe refund reasons), G-71, G-86; G-91 and G-92 handed to Denis Zoi. G-97 part 1 merged; its items 2 to 4 stay open (parked).
