# ADR-0035: Booking policy snapshots and guest cancellation requests

Status: Accepted owner direction, 2026-10-23. Implementation and verification recorded separately.

## Decision

The owner selected the hotel's configured cancellation policy as the agreed policy for new bookings made through MUST, including Clock-connected hotels. Save immutable terms at booking creation. Imported bookings and older records without confirmed terms require staff review; never apply today's default retrospectively or infer terms from a Clock policy ID. Changing hotel policy applies to future bookings only.

A signed Manage booking link opens a read-only preview. Opening or scanning a link never cancels a booking. Cancellation eligibility is rechecked at confirmation in the saved hotel timezone. Before the saved free-cancellation deadline, eligible bookings may use the existing cancellation/refund orchestrator. Inside the restricted period, or with unknown policy/financial eligibility, a guest submits a request for staff approval and the booking stays active. Refund eligibility never exceeds verified refundable payment coverage. Repeated requests and confirmations must be idempotent.

Guest requests must retain their guest origin and scoped booking identity; no fabricated staff identity or automatic approval is permitted. Staff capability/approval controls and tenant/property isolation continue to apply. Existing standalone bookings keep their current flow unless they have new saved terms. Provider financial inconsistencies remain a separate block and are not repaired by policy configuration.
