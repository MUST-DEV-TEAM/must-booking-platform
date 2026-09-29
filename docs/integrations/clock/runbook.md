# Clock setup and diagnosis

Status: **SOURCE-BACKED procedure; live setup must be verified on the target environment**. Updated 2026-09-19.

## Before operating

Use the active deployment record in [operations](../../operations/README.md), not retired homelab names. This document is guidance, not permission to probe a provider, change secrets or mutate reservations. Resolve the exact tenant/property/connection, environment and authorized operation before running it; never print decrypted credentials.

The platform owns encrypted tenant connections. Review `IntegrationConnectionsService`, `CredentialCipherService`, `clock-http-client.ts` and `clock-credentials.ts` before changing connection data. A connection test is a real outbound provider request.

## Connect and map

1. Configure a tenant-owned Clock PMS connection through the supported integration-management surface, using the target account's verified credentials and plan entitlement.
2. Test that connection, assign it to the intended property and verify it is enabled/CONNECTED. One enabled property per connection is required by the current webhook handler.
3. Run catalog synchronization, review proposals, confirm room types before physical rooms. Prices use published child rates and optional ranking; do not enter a parent rate-plan ID as a rate.
4. Check public catalog/quote/search behavior, then an explicitly authorized final booking/payment/cancel scenario. A successful ping is not integration acceptance.

## SNS setup

The callback is `/clock-webhooks/:webhookPublicId`, using the random installation ID, not the internal connection ID. Next's rewrite supports this path; verify actual proxy routing in the target environment instead of recreating the former homelab topology.

Historical setup used Clock's Digest-authenticated Base API `/webhook_subscription` GET/POST/DELETE. Contract details and rights must be checked against the [endpoint matrix](endpoint-matrix.md) before a new setup. The 2026-09-03 notes record POST with the same endpoint as recovery for missed confirmation; do not delete a subscription by default.

Pin the **topic ARN**, not the longer subscription ARN, in encrypted credentials as `snsTopicArn` before expecting messages to pass. The current structured UI does not expose this field; the create service accepts a string-valued credentials object, but there is no dedicated SNS onboarding or credential-update endpoint in the current connection service. Any administrative credential edit must retain tenant scoping, encryption and audit handling; do not paste a blanket SQL update from an old host.

Verify actual confirmed subscription state and a signed notification through ingestion, persistence, enqueue and hydration. A 200 for confirmation alone is insufficient: the current service ignores a failed confirmation callback's boolean result.

## Diagnose by layer

| Symptom | Check |
| --- | --- |
| No delivery / HTML or proxy error | Public routing and API path; text/plain SNS parsing in `main.ts` |
| Topic mismatch | Bare topic ARN versus subscription ARN, correct connection/environment |
| Signature/freshness rejection | Timestamp, expected signing host/certificate and signature; do not disable verification |
| Accepted event, no booking change | Enabled-property count; persisted event; queue enqueue; recognized type; mapping; worker error/dead-letter |
| Event stored but no queued job | Known insert/enqueue gap; do not assume redelivery repairs it |
| Paid booking not confirmed | Booking state, payment/session record, integration operation and manual-review item; lookup vendor reference before considering any retry |
| Confirmed booking, no deposit | Original credit-item reference, deposit folio and manual-review/notification; do not create another charge blindly |
| Financial reconciliation fails | Check the known `reference.eq` contract mismatch before trusting its coverage |
| No operational alert | Reporting configuration and actual delivery, not merely Sentry call sites |

Manual-review resolution is not automatic recovery. No general queue replay/reconciliation-repair admin workflow is documented as implemented. Prepare a targeted, idempotent corrective plan before changing financial/provider state.

## Acceptance evidence

The [archived sandbox report](../../archive/clock-sandbox-validation-2026-08-05.md), [test log](../../archive/clock-test-evidence-2026-09-04.md) and [Milestone 21](../../roadmap/milestones/21-clock-certification-fixes.md) record past observations. They do not certify today's deployment. Current deposit behavior leaves folios open; old close instructions are superseded. Retain the distinction between local tests, sandbox observations and production verification in every new report.
