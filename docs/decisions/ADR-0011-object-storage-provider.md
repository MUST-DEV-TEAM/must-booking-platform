# ADR-0011: Object storage provider and access model

Status: Accepted
Date: 2026-07-28

## Context

`docs/architecture/overview.md` lists "object storage" as an infrastructure line item alongside managed Postgres/Redis, but never named a provider, an interface, a bucket/key convention, a credential model, an upload size/type policy, or a retrieval/signing model. Milestone 3's Task 3 (room-type image upload) is the first feature that actually needs it; Codex correctly stopped rather than inventing durable storage behavior and security boundaries unprompted.

## Options — provider

1. **Cloudflare R2** — S3-compatible API, so the same tooling/SDK patterns as AWS S3 apply. Zero egress fees, which matters specifically here: room-type photos are downloaded repeatedly by every visitor browsing a public listing, unlike most stored data which is read rarely. Free tier (10GB storage, unlimited egress) is usable indefinitely. Supports an EU jurisdiction restriction on the bucket for ADR-0004's residency requirement.
2. **AWS S3** (`eu-west-1` or `eu-central-1`) — the most standard/ubiquitous choice, widest tooling support, well-documented presigned-URL patterns, straightforward EU region pinning. Costs more at scale since egress bandwidth is billed per-GB, which compounds for publicly-served marketing images specifically.

## Options — access model

1. **Public-read bucket, presigned upload only** — anyone with the image URL can view it (room-type photos are guest-facing marketing content, not private guest PII, and are meant to be seen by prospective guests without authentication — the same pattern most travel-booking sites use). Uploads require a short-lived presigned PUT URL issued by the API after an authorization check (owner/admin, verified email, tenant/property match); the client uploads directly to storage, not proxied through the API server.
2. **Fully private, presigned URLs for both directions** — every read also requires a per-request signed URL from the API. More uniform access control, but adds real complexity (URL expiry handling, no simple `<img src>` caching) for content that isn't actually sensitive.

## Decision

Cloudflare R2, with a public-read bucket and presigned-upload-only access model.

Accepted by the owner on 2026-07-28.

### Amendment — 2026-10-21: interim local disk

Owner decision: defer R2 and use local disk on `booking.must.al`. Keep the R2 provider.
`STORAGE_DRIVER=local|r2` selects the provider; omission defaults to `r2` for compatibility.
Local storage requires `LOCAL_STORAGE_DIR` and `LOCAL_STORAGE_PUBLIC_BASE_URL`.
The existing authorize/PUT/confirm contract remains: local authorization returns a same-origin
authenticated API PUT URL instead of a presigned R2 URL. Upload authorization and the local PUT
require a verified tenant owner/admin, `photos.manage`, tenant/property access and a reserved key.

Local uploads accept only JPEG, PNG and WebP, at most 10 MiB of actual bytes. Signature checks
and full decoding reject spoofed or corrupt files. Images are auto-oriented, metadata stripped,
resized without enlargement to a maximum 2000-pixel long edge, and encoded as WebP (quality 80).
Decoding is limited to 40 megapixels and one active conversion per API process; concurrent
conversions receive 409 and can be retried. New local keys end in `.webp`.
The `room-types/{tenantId}/{propertyId}/{roomTypeId}/{uuid}.{ext}` layout is retained, as is
main's existing `library/{tenantId}/{propertyId}/{uuid}.{ext}` layout for property-library uploads.
Keys are validated and files cannot be overwritten. The library owns shared files: removing a
room attachment retains the library file; deleting an unused library photo removes the disk file.

Photos live in a named Docker volume, served publicly at `/photos/` by a read-only nginx
service with a one-year immutable cache. This is single-host storage; back up the volume
alongside the database. See [deployment steps](../../infrastructure/containers/README.md#interim-local-photo-storage).
Migration back to R2 is copy files with identical keys, then switch the driver and public base.
Keep the public `/photos/` origin stable (proxy it to the new storage) to preserve URLs already
materialized in room records and caches. R2's existing direct-upload path is unchanged and does
not gain the local decoder/optimizer; equivalent byte validation there remains future work.

## Consequences

- A `StorageProvider` interface is added (in `packages/domain-contracts`, mirroring the existing `MailProvider`/`PmsProvider`/`BillingProvider` pattern), with an R2 implementation behind it in `apps/api`'s infrastructure layer — domain/application code never calls the R2 SDK or HTTP API directly.
- The initial `StorageProvider` surface issued presigned upload URLs and resolved object keys to public URLs. The room-photo gallery later adds deletion of a specific object key after the tenant/property-scoped API confirms the image belongs to that room type. It still exposes no provider-wide list operation.
- Object keys are namespaced by tenant and property (e.g. `room-types/{tenantId}/{propertyId}/{roomTypeId}/{uuid}.{ext}`), so even though the bucket is public-read, keys are not guessable/enumerable and tenant boundaries are preserved in the key structure itself, not just relied on for access control.
- Upload policy: images only (`image/jpeg`, `image/png`, `image/webp`), enforced both client-request-side (reject other content types when issuing the presigned URL) and, where R2's presigned-POST/PUT conditions allow, at the storage layer; a per-file size cap (10 MB) is enforced the same way.
- New configuration: R2 account ID, access key ID, secret access key, bucket name, and the bucket's public base URL (custom domain or `r2.dev` subdomain) — added to `apps/api/.env.example` as `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`. **Correction (2026-07-28, caught before implementation):** these are provider credentials, the same shape as `RESEND_API_KEY`/`MAIL_FROM_EMAIL` — *not* boot-time required like `WEB_APP_URL`. `environment.ts`'s `requiredEnvironmentVariables` must not include them; the R2 `StorageProvider` implementation throws a clear per-call error if invoked without configuration (mirroring `ResendMailProvider.requiredEnvironment()`), so a missing/absent R2 config never crashes app bootstrap or breaks the existing test/dev environment.
- Automated tests must mock `StorageProvider` (override the provider token in the NestJS testing module, same pattern already used for `MAIL_PROVIDER`) rather than hitting real R2 — no real R2 credentials are needed for the test suite to pass, and none should be requested for that purpose. Per `AGENTS.md`'s "no live requests to external providers without explicit approval," real R2 credentials are only needed later for an actual manual/live verification pass, not for CI/automated tests.
- The R2 bucket itself must be provisioned with an EU jurisdiction/location hint per ADR-0004; this is an infrastructure/ops action outside the application code, tracked the same way the Postgres/Redis EU-region requirement is.
- Any future upload feature (not just room-type photos) reuses the same `StorageProvider` interface rather than each feature inventing its own storage integration.

## Alternatives considered

- AWS S3: rejected primarily on the egress-cost concern for publicly-served images, given no other part of the stack currently commits to AWS specifically (ADR-0004 named "EU region" generically, not a cloud provider).
- Fully private/signed-read model: rejected as unnecessary complexity for non-sensitive, guest-facing marketing content.
