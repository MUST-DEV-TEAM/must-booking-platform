# WordPress predecessor documentation

**HISTORICAL / SUPERSEDED as platform guidance.** These 15 files came from `apps/wordpress-plugin/docs/` and describe the standalone plugin's July 2026 `0.4.92` baseline. They explain retained classes/tables and past decisions; their release, deployment, payment ownership and staff-portal claims do not establish current runtime behavior.

The platform retrofit delegates guest booking to the MUST API. Read [current frontends and API](../../architecture/frontends-and-api.md) and [operations](../../operations/README.md) first. The plugin's five ADR numbers are a separate historical namespace from platform ADRs. Original bodies/statuses remain intact and do not authorize implementation or operations.

| File | Retained purpose / classification |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | HISTORICAL predecessor architecture/behavior; partially obsolete after retrofit. |
| [ADR-0001: Payment-first Clock fulfillment](decisions/ADR-0001-payment-first-clock-fulfillment.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [ADR-0002: Final live quote revalidation](decisions/ADR-0002-final-live-quote-revalidation.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [ADR-0003: Clock deposit isolation and manual accounting boundaries](decisions/ADR-0003-clock-deposit-and-manual-accounting-boundaries.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [ADR-0004: Provider source of truth and lifecycle routing](decisions/ADR-0004-provider-source-of-truth-and-lifecycle-routing.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [ADR-0005: Clock exact physical-room availability authority](decisions/ADR-0005-clock-exact-physical-room-availability.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [Decision Register](DECISIONS.md) | HISTORICAL decision reasoning; separate plugin namespace, not a platform ADR. |
| [Domain Lifecycles](DOMAIN_LIFECYCLES.md) | HISTORICAL predecessor architecture/behavior; partially obsolete after retrofit. |
| [Documentation Index](INDEX.md) | SUPERSEDED navigation; current routing is docs/README.md. |
| [Integrations](INTEGRATIONS.md) | HISTORICAL predecessor architecture/behavior; partially obsolete after retrofit. |
| [Operations](OPERATIONS.md) | HISTORICAL operational procedures; do not execute against current deployments without a scoped plan. |
| [Project Context](PROJECT_CONTEXT.md) | HISTORICAL predecessor architecture/behavior; partially obsolete after retrofit. |
| [Project Timeline](PROJECT_TIMELINE.md) | HISTORICAL incidents and implementation chronology. |
| [Repository Consolidation Plan](REPOSITORY_CONSOLIDATION_PLAN.md) | SUPERSEDED predecessor cleanup plan; not a MUST platform task authorization. |
| [UI and UX Contract](UI_UX.md) | HISTORICAL predecessor architecture/behavior; partially obsolete after retrofit. |
