# ADR-0003: Clock deposit isolation and manual accounting boundaries

- Status: Accepted
- Date: 2026-06-24
- Scope: Website payments, refunds, folio accounting, cancellation cleanup, and amendment deltas in Clock PMS
- Supersedes: Unverified use of aggregate booking balance as deposit proof
- Superseded by: —
- Evidence confidence: Verified for current implementation; provider-contract evidence is dated

## Context

Gateway payment, Clock payment accounting, accommodation revenue, cancellation fees, refunds, and amendment deltas are distinct financial facts. Clock exposes generic folio, credit-item, and charge operations, but the plugin cannot always prove charge ownership or safely select the row and folio to mutate.

Repository evidence also shows that an isolated held deposit may have a negative raw Clock balance while the booking header shows an aggregate zero balance.

## Decision

- Post eligible future website payments to an open `deposit=true` Clock folio.
- Snapshot the standard folio and require it to remain unchanged.
- Verify the signed raw balance movement and a normalized held amount; do not infer success from aggregate booking balance alone.
- Correlate gateway, provider transaction, reservation, operation, folio, and the real provider credit-item identifier. Recovery requires exact reference, amount, and currency agreement.
- Automatically reverse a Clock item only when the original verified item remains on an open, unused deposit folio.
- Keep accommodation-charge cleanup, cancellation-fee posting, uncertain legacy-folio changes, and amendment financial deltas as explicit manual-review states until durable charge ownership and targeting exist.

## Alternatives considered

- Post website payments to the standard accommodation folio. Rejected because it mixes deposit and revenue ownership.
- Infer success whenever the final balance looks plausible. Rejected because unrelated entries can produce the same balance.
- Use generic charge APIs to automate cancellation cleanup. Rejected because the plugin does not persist enough charge-level identity to prove safe ownership.

## Consequences

### Positive

- Website deposit accounting is isolated from accommodation revenue.
- Ambiguous money movements remain visible instead of being silently repaired.
- Refund and cancellation states remain separate and auditable.

### Negative

- Some cleanup requires staff action.
- Provider operations can still be ambiguous after a timeout or missing item identity.
- Missing or ambiguous provider item identity requires manual review; balance evidence and local idempotency keys are not substitutes for a Clock credit-item ID.

## Implementation constraints

- Do not create, delete, or compensate a Clock charge without durable ownership evidence and a documented folio-targeting rule.
- Use provider item identity for idempotency whenever available.
- Preserve immutable cancellation-time financial snapshots for review.
- A gateway refund and a Clock negative accounting item are separate operations with separate success states.
- Redact credentials, authorization data, personal data, and full provider payloads from logs and documentation.

## Verification

- Read before/after standard and deposit folios.
- Verify signed raw balance and normalized held amount.
- Replay payment/refund accounting and simulate timeouts after provider write.
- Reject closed, transferred, applied, ambiguous, or wrong-folio cases into manual review.
- Test collisions where an unrelated item produces the expected aggregate balance.

## Evidence

- `src/Provider/Clock/ClockPaymentAccountingService.php`.
- `src/Provider/Clock/ClockPaymentReconciliationService.php`.
- `src/Database/ClockFolioAccountingRepository.php`.
- Decisions and implementation commits `c5017e1` and `1301933` (`v0.4.86`).
- Dated Clock research formerly held under `docs/research/clock/`; it is evidence, not a current provider contract.
