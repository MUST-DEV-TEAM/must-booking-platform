# ADR-0038: Hotel exchange rates override the display feed

Status: Accepted owner direction 2026-10-28
Date: 2026-10-28

## Decision

Hotel rates win per currency; the existing platform feed is the fallback. Store one display-currency unit in hotel-default-currency units, as NUMERIC(20,8). Converted website prices remain approximate and never change booking, charge or refund amounts/currencies. New payment ledger rows may snapshot the applicable hotel/feed ratio for their existing approximate booking-currency annotation; existing snapshots are immutable.

Tenant/property-scoped settings and append-only change records are protected by RLS. Owner/admin users with settings.manage and verified email can write. Explicit display-currency selection is separate from an override: removing a rate restores feed resolution without removing that currency. Existing sites without a selection retain their widget choices.

The public API supplies the base, sources, a monotonic property configuration version and a content ETag covering feed changes too. WordPress revalidates every ten minutes and serves its last good payload on failure. Pairing has no retained shared credential, so no signed push or new secret is introduced.

## Consequences

The default currency must be explicitly chosen before entering overrides and cannot change while overrides exist. The additive migration runs before API rollout; rollback may retain the new settings/audit tables and restore the preceding payment trigger function. No backfill is performed. See [currency roadmap](../roadmap/milestones/29-currency.md) for implementation/review evidence.
