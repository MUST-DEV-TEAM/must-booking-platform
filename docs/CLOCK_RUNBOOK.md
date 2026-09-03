# Clock PMS+ Runbook

Source brief Appendix B deliverable — not written at Milestone 11 close-out (sandbox-only scope, no live Message Channels subscription existed yet — see `docs/roadmap/completed/11-clock-pms-adapter-basic.md`). First written 2026-09-03, the day a real Message Channels subscription was activated for Empire Beach Resort for the first time, after several real, previously-undiscovered bugs blocked it. This document is the procedure to repeat that setup on a new environment (Milestone 14's planned homelab-to-new-host rebuild is a clean rebuild, not a data migration — see `docs/roadmap/milestones/14-security-and-architecture-audit.md` — so every step below needs to be re-run there, not just re-verified).

## What Clock actually requires (confirmed 2026-09-03, not assumed)

Clock's own Postman docs (`base_api (Financial Data) > PUSH/Webhooks`, "Clock PMS+ API Docs" workspace) define three operations, all Digest-authenticated, all under `/base_api/{subscription_id}/{account_id}/webhook_subscription`:

| Method | Purpose | Notes |
| --- | --- | --- |
| `GET` | View the current subscription for this API user | Returns `404`-equivalent-shaped emptiness if none exists, otherwise `{account_id, user_id, subscription_arn, endpoint, pending_confirmation}` |
| `POST` | Create (or re-trigger confirmation for) a subscription | Body: `{"endpoint": "<url>"}`. Re-sending the exact same endpoint is Clock's own documented recovery path if a confirmation was missed — no need to delete first. |
| `DELETE` | Remove the current subscription | **Fails with `HTTP 500`** (`"Cannot unsubscribe a subscription that is pending confirmation"`) if the subscription hasn't confirmed yet — this is a genuine AWS SNS constraint, not a Clock bug. Also blocked for 48 hours after creation per Clock's own UI warning. |

The API user needs the `base_api_webhook_subscription_show` right (and whatever the create/delete rights are bundled as) granted by Clock support — confirmed granted for Empire Beach Resort's account 2026-09-03 (was previously `403`).

## Prerequisites this account already has (verify, don't assume, on a new account)

- A Clock API user with the webhook-subscription right granted (ask Clock support / integrations@clock-hs.com if a fresh `403` comes back on the `GET` below).
- `INTEGRATION_CREDENTIALS_KEY` set in the API container's environment (needed to decrypt/re-encrypt the connection's stored credentials — see below).

## Step-by-step procedure

### 1. Give the API service a real public URL

The API container (`must-booking-api-1` on the homelab) has no public URL by default — it's `internal`-network-only, unlike `web` which is fronted by the reverse proxy already. **This is infrastructure-specific and must be redone on the new environment regardless of what reverse-proxy tooling it uses.** On the homelab specifically, this meant:

1. Attach the api service to the same Docker network the reverse proxy uses (`infrastructure/containers/compose.homelab.yaml` — `api`'s `networks:` now includes `proxy`, matching `web`'s existing entry; this must be in the compose file itself, not just a live `docker network connect`, or the next deploy silently drops it — confirmed 2026-09-03, caused a real production 502).
2. Add a reverse-proxy entry (nginx-proxy-manager: a Proxy Host with domain `api.<host>`, forwarding to the container name on port `3000`, no separate SSL cert needed if a tunnel already terminates TLS in front of it).
3. Add a DNS/tunnel entry for the new hostname (Cloudflare Tunnel: Zero Trust → Networks → Tunnels → Public Hostname → point it at the same backend the other hostnames use).

Confirm with a plain request before going further:
```bash
curl -i https://<new-public-api-host>/clock-webhooks/<any-uuid>
```
Getting a JSON 404 from the API (not an HTML page from `web`, and not a connection failure) confirms routing is correct.

### 2. Find the connection's real webhook URL

The webhook path is `/clock-webhooks/:webhookPublicId` — `webhookPublicId` is a random UUID stored per `IntegrationConnection` row (`integration_connections.webhook_public_id`), **not** the connection's own `id`. On a fresh environment this will be a brand-new UUID (new row, since re-onboarding is not a data migration):

```bash
docker exec must-booking-postgres-1 psql -U must_booking -d must_booking -t -A -c \
  "SELECT id, webhook_public_id, status FROM integration_connections WHERE tenant_id='<tenant-id>' AND provider='CLOCK_PMS' AND kind='PMS';"
```

The full webhook URL to give Clock is `https://<public-api-host>/clock-webhooks/<webhook_public_id>`.

### 3. Register the subscription with Clock

Requires a small Node script run inside `must-booking-api-1` (has `INTEGRATION_CREDENTIALS_KEY` in its env already) that decrypts the connection's stored credentials (AES-256-GCM, same scheme as `credential-cipher.ts`), builds a Digest-authenticated request (RFC 7616, same scheme as `clock-digest-auth.ts`), and calls `POST .../webhook_subscription` with `{"endpoint": "<the URL from step 2>"}`. No standing script for this exists in the repo (deliberately — it touches decrypted credentials and shouldn't be a committed, always-available tool); write one fresh each time following the pattern in `clock-http-client.ts`/`clock-digest-auth.ts`, or ask whoever last did this (this session, 2026-09-03) for the throwaway script.

### 4. Pin the topic ARN (security-critical — do not skip)

`ClockWebhookService.isExpectedTopic` rejects any SNS message whose `TopicArn` doesn't exactly match `snsTopicArn` stored in that connection's encrypted credentials — by design, so a webhook URL leak can't be used to inject events from an unrelated AWS account (see `docs/roadmap/completed/12-integration-and-initial-release.md`'s Task 5 security review). This field is **not settable through any UI or API endpoint today** — there's a real, still-open gap here (see "Known gaps" below).

**The value must be the bare topic ARN, not the subscription ARN.** Step 3's response includes `subscription_arn`, e.g. `arn:aws:sns:eu-west-1:006467213368:PUSH_16307_HOTEL_DEMO:cf40337c-2521-4d50-a3c4-fae6263292d7` — the trailing `:cf40337c-...` is the subscription's own ID, not part of the topic. Strip it: `snsTopicArn` = `arn:aws:sns:eu-west-1:006467213368:PUSH_16307_HOTEL_DEMO`. Using the full subscription ARN here was a real mistake made and caught 2026-09-03 — every confirmation attempt failed with "topic mismatch" until corrected. The bare-topic-ARN shape is confirmed against this project's own test fixtures (`clock-webhook.e2e.spec.ts`).

The topic ARN itself (`PUSH_16307_HOTEL_DEMO` for this Clock account) looks tied to the Clock account/API user, not to which URL you point the subscription at — likely stable across re-subscriptions from the same account, but **verify with a fresh `GET` rather than assume** on a new environment.

To set it: decrypt the connection's `encrypted_credentials`, merge in `snsTopicArn`, re-encrypt with the same `INTEGRATION_CREDENTIALS_KEY`, and `UPDATE integration_connections SET encrypted_credentials = '<new-blob>' WHERE id = '<connection-id>'`. Same script pattern as step 3.

### 5. Confirm

Re-send step 3's `POST` (same endpoint — this is the documented "missed confirmation" recovery, no delete needed) and check:
```bash
docker logs must-booking-api-1 --since 2m | grep clock-webhook
```
A clean single `200` (no `"Rejected Clock webhook"` warning) means the real AWS-signed `SubscriptionConfirmation` arrived, passed signature verification, passed the topic check, and `ClockWebhookVerificationService.confirmSubscription` successfully called back to AWS's `SubscribeURL`. Verify with a plain `GET` on `webhook_subscription` — `pending_confirmation: false` is the real, final signal.

## Known gaps this exposed (not fixed as part of getting the subscription live)

- **No UI/API to set `snsTopicArn`.** Every existing Clock connection needs this done by hand (decrypt/re-encrypt/`UPDATE`) — a real, now-proven-necessary feature gap, not hypothetical. Worth a dedicated task before the next environment rebuild, so this runbook's steps 4 collapses to a normal admin action.
- **Amazon SNS delivers with `Content-Type: text/plain`, not `application/json`.** Fixed in `apps/api/src/main.ts` (a route-scoped body parser that reads any content-type as JSON, only for `/clock-webhooks`) — this fix is permanent and ships with the app, no environment-specific step needed. Worth knowing if this code is ever refactored: don't reintroduce a JSON-only parser on this route.
- **Receiving a real event still does nothing.** The queue processor for `clock.webhooks` (`ClockWorkerService`) is still skeleton-only — it logs receipt and stops. Fetching the changed object from Clock, normalizing it, and applying it to local data (Milestone 11.5/12's parked Task 16/17) is genuinely separate, unbuilt work. This runbook only gets Clock's messages *arriving*; nothing downstream exists yet.

## Cleanup

Throwaway scripts used 2026-09-03 (`/tmp/repoint.js`, `/tmp/resend.js`, `/tmp/add-sns-topic-arn.js`, `/tmp/verify.js` inside `must-booking-api-1`) were deliberately not committed — they handle decrypted credentials and shouldn't be standing, always-available tools. They don't survive a container restart (ephemeral `/tmp`) and don't need manual deletion.
