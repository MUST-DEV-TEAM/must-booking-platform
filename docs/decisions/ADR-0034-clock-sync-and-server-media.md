# ADR-0034: Automatic Clock read synchronization and persistent server media

Status: Accepted owner direction (2026-10-22); local implementation evidence recorded in Milestone 24. Production enablement and restore verification remain separate.

## Context

The owner approved the 15-point corrective plan on 2026-10-22. Daily Calendar, Inventory, Guests and Rates screens must use synchronized data, not require manual imports/Load buttons. Hotel images must use persistent server storage instead of Cloudflare R2. This supersedes ADR-0011's provider choice; tenant isolation, upload validation and access control remain required.

## Decision

Clock remains authoritative for its owned data. Maintain tenant/property/connection-scoped durable read snapshots, background job checkpoints and freshness/error status. Initial synchronization reads supported catalog, all available guest/booking history, future bookings and a bounded availability horizon. Incremental reads and scheduled reconciliation recover changes missed by supported webhooks. Request handlers read stored data and may enqueue missing ranges without contacting Clock synchronously. Final reservation pricing/availability remains a fresh provider check. Do not derive authoritative free stock by subtracting a partial booking list from capacity, recreate historical financial ledger entries, send historical emails or invent unsupported Clock endpoints/fields.

Jobs use scoped leases, bounded batches, stable external identities, recorded progress, rate limiting and classified errors. Automated writes update local projections only; commands that create/cancel bookings or move money keep their existing explicit flows. A reconnect is a new connection identity and must not expose the old connection's snapshots. Source timestamps prevent an older bulk read from overwriting a newer provider projection. Local execution is restricted to the owner-authorized Demo Beach sandbox property; enabling production synchronization is a separate deployment action.

New uploads use a persistent server directory outside application build output, tenant/property namespaces, authenticated upload authorization, size/type/content validation and controlled public image serving. Private email archives/documents stay private. No existing remote object is deleted or silently relocated. Backups and restore verification must include media; storage must survive container/app replacement. Keep the existing StorageProvider boundary where compatible. R2 remains an optional legacy reader/rollback path during migration.

## Consequences

Additive migrations require forced RLS, composite scoped foreign keys and explicit archival rollback notes. Setup shows synchronization progress and actionable failures; daily pages show stored data and freshness. Unsupported complete tax/block definitions remain explicit gaps. Background synchronization and local-disk media need focused isolation/restart/error tests and sandbox/browser verification before being reported complete.
