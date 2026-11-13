# ADR-0042: Data retention periods

Status: Periods accepted by the owner on 2026-11-13 (Milestone 38, decisions D3 and D4). First release counts only.

## Context

Several tables grew without a written limit (database review 2026-11-13, item 10). Some rows are only needed for a short time: the raw body of a webhook after it has been processed, and the stored answer that makes a repeated request safe. Others are records a hotel or MUST must keep: guests, payments, provider money operations and the audit log.

## Decision

| Data | Period | Action |
| --- | --- | --- |
| `provider_events.raw_payload`, events in `HYDRATED` or `IGNORED` | 90 days | Replace the payload with `{}`. **Keep the row**: its `(connection_id, event_id)` pair recognises a re-delivered webhook. Events still `RECEIVED`, `QUEUED`, `FAILED` or `NEEDS_RECONCILIATION` stay whole. |
| Idempotency receipts: `email_workspace_operations`, `guest_capture_operations`, `inventory_block_operations`, `inventory_restriction_operations`, `inventory_stock_operations`, `pricing_operations`, `report_view_operations` | 30 days | Delete. |
| Email previews, audit export and notification receipts | Unchanged | They already expire sooner in their own services. |
| `integration_operations`, `venue_deposit_operations`, `venue_deposit_receipts` | No limit here | Money evidence. |
| `guests`, `clock_guest_profiles` | No deletion (D4) | The hotel's guest directory. |
| `audit_logs` | No deletion now; revisit at 2 years (D3) | Append-only (ADR-0037). |

- One nightly job (`DataRetentionService`, 02:41 UTC) applies the rules hotel by hotel, inside that hotel's row-level security.
- Rollout: the first release only counts and logs, per hotel and rule. The owner reviews the numbers. The next release acts, in batches of 1,000, first on the test hotel only, then on all hotels. The nightly backup is the rollback.

## Consequences

- After 90 days, a processed webhook can no longer be re-read from MUST; Clock remains the source of the booking itself.
- A client repeating a request more than 30 days later is treated as a new request. Clients repeat within minutes.
- Standard practice for guest data (D4) still asks the hotel for a stated period after the last stay, deletion on request except what the law requires, no marketing without consent, and limited access. None of that is built here. A guest deleted in Clock stays in `clock_guest_profiles`, because the import only adds and updates (open follow-up).

## Alternatives considered

- Deleting old `provider_events` rows: rejected, because the row is the duplicate guard for re-delivered webhooks.
- Shorter receipt periods (7 days): no measurable gain; the tables are small. 30 days leaves room for a client retrying after an outage.
