# ADR-0002: Final live quote revalidation

- Status: Accepted
- Date: 2026-06-23
- Scope: Clock-backed search, quote, and final booking validation
- Supersedes: Reuse of intermediate provider results at the final write boundary
- Superseded by: —
- Evidence confidence: Verified

## Context

Clock reads can be slow enough to harm the public booking experience. Short-lived caching improves intermediate search and quote rendering, but accepting cached availability or price immediately before reservation creation can oversell inventory or charge a stale amount.

## Decision

Intermediate Clock availability/product quote reads may use a bounded cache. The final checkout boundary must bypass request-local and transient caches and obtain a fresh provider result before any provider reservation or payment write. A signed, expiring, session-bound quote draft records what the guest reviewed; final total, currency, and guarantee policy are compared with the fresh response. A meaningful mismatch stops the flow and asks the guest to review.

## Alternatives considered

- Disable all caching. Rejected because it makes every intermediate interaction pay provider latency.
- Reuse the last search response for final booking. Rejected because freshness is more important than latency at the commitment boundary.
- Revalidate only availability. Rejected because price and guarantee changes also alter the guest's agreement.

## Consequences

### Positive

- Intermediate UI remains responsive without weakening final inventory and price integrity.
- The reviewed quote is traceable and tamper-resistant for its short lifetime.

### Negative

- Checkout still incurs a live provider request.
- A guest may have to review a changed quote instead of completing immediately.
- Current final comparison does not reliably enforce every drafted policy field; cancellation-policy comparison remains a documented gap.

## Implementation constraints

- Cache lifetime must remain bounded and must never cross the final-write boundary.
- Quote drafts must be signed, expiring, and bound to the relevant browser/session selection.
- Final mismatch must stop before payment/provider creation.
- Provider unavailability must not silently become a successful Clock booking; local fallback behavior requires explicit mode and operator understanding.

## Verification

- Prove final reads bypass both request-local and transient caches.
- Change availability, total, currency, guarantee, and cancellation policy between quote and submit.
- Test expired, modified, and wrong-session quote drafts.
- Test provider timeout without converting uncertainty into success.

## Evidence

- `src/Engine/BookingQuoteDraft.php`.
- `src/Provider/Clock/ClockQuoteProvider.php` and final validation in the reservation path.
- Commit `e0a95f3` (`v0.4.85`) and its focused tests.
