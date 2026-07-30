# ADR-0011: Object storage provider and access model

Status: Accepted
Date: 2026-07-28

## Context

`docs/ARCHITECTURE.md` lists "object storage" as an infrastructure line item alongside managed Postgres/Redis, but never named a provider, an interface, a bucket/key convention, a credential model, an upload size/type policy, or a retrieval/signing model. Milestone 3's Task 3 (room-type image upload) is the first feature that actually needs it; Codex correctly stopped rather than inventing durable storage behavior and security boundaries unprompted.

## Options — provider

1. **Cloudflare R2** — S3-compatible API, so the same tooling/SDK patterns as AWS S3 apply. Zero egress fees, which matters specifically here: room-type photos are downloaded repeatedly by every visitor browsing a public listing, unlike most stored data which is read rarely. Free tier (10GB storage, unlimited egress) is usable indefinitely. Supports an EU jurisdiction restriction on the bucket for ADR-0004's residency requirement.
2. **AWS S3** (`eu-west-1` or `eu-central-1`) — the most standard/ubiquitous choice, widest tooling support, well-documented presigned-URL patterns, straightforward EU region pinning. Costs more at scale since egress bandwidth is billed per-GB, which compounds for publicly-served marketing images specifically.

## Options — access model

1. **Public-read bucket, presigned upload only** — anyone with the image URL can view it (room-type photos are guest-facing marketing content, not private guest PII, and are meant to be seen by prospective guests without authentication — the same pattern most travel-booking sites use). Uploads require a short-lived presigned PUT URL issued by the API after an authorization check (owner/admin, verified email, tenant/property match); the client uploads directly to storage, not proxied through the API server.
2. **Fully private, presigned URLs for both directions** — every read also requires a per-request signed URL from the API. More uniform access control, but adds real complexity (URL expiry handling, no simple `<img src>` caching) for content that isn't actually sensitive.

## Decision

Cloudflare R2, with a public-read bucket and presigned-upload-only access model.

Accepted by the owner on 2026-07-28.

## Consequences

- A `StorageProvider` interface is added (in `packages/domain-contracts`, mirroring the existing `MailProvider`/`PmsProvider`/`BillingProvider` pattern), with an R2 implementation behind it in `apps/api`'s infrastructure layer — domain/application code never calls the R2 SDK or HTTP API directly.
- `StorageProvider` exposes at minimum: issuing a presigned upload URL for a given object key + content type, and resolving an object key to its public URL. No general-purpose delete/list surface is required yet — only what Task 3 needs.
- Object keys are namespaced by tenant and property (e.g. `room-types/{tenantId}/{propertyId}/{roomTypeId}/{uuid}.{ext}`), so even though the bucket is public-read, keys are not guessable/enumerable and tenant boundaries are preserved in the key structure itself, not just relied on for access control.
- Upload policy: images only (`image/jpeg`, `image/png`, `image/webp`), enforced both client-request-side (reject other content types when issuing the presigned URL) and, where R2's presigned-POST/PUT conditions allow, at the storage layer; a per-file size cap (10 MB) is enforced the same way.
- New configuration: R2 account ID, access key ID, secret access key, bucket name, and the bucket's public base URL (custom domain or `r2.dev` subdomain) — added to `apps/api/.env.example` as `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`. **Correction (2026-07-28, caught before implementation):** these are provider credentials, the same shape as `RESEND_API_KEY`/`MAIL_FROM_EMAIL` — *not* boot-time required like `WEB_APP_URL`. `environment.ts`'s `requiredEnvironmentVariables` must not include them; the R2 `StorageProvider` implementation throws a clear per-call error if invoked without configuration (mirroring `ResendMailProvider.requiredEnvironment()`), so a missing/absent R2 config never crashes app bootstrap or breaks the existing test/dev environment.
- Automated tests must mock `StorageProvider` (override the provider token in the NestJS testing module, same pattern already used for `MAIL_PROVIDER`) rather than hitting real R2 — no real R2 credentials are needed for the test suite to pass, and none should be requested for that purpose. Per `AGENTS.md`'s "no live requests to external providers without explicit approval," real R2 credentials are only needed later for an actual manual/live verification pass, not for CI/automated tests.
- The R2 bucket itself must be provisioned with an EU jurisdiction/location hint per ADR-0004; this is an infrastructure/ops action outside the application code, tracked the same way the Postgres/Redis EU-region requirement is.
- Any future upload feature (not just room-type photos) reuses the same `StorageProvider` interface rather than each feature inventing its own storage integration.

## Alternatives considered

- AWS S3: rejected primarily on the egress-cost concern for publicly-served images, given no other part of the stack currently commits to AWS specifically (ADR-0004 named "EU region" generically, not a cloud provider).
- Fully private/signed-read model: rejected as unnecessary complexity for non-sensitive, guest-facing marketing content.
