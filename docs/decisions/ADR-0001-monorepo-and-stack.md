# ADR-0001: Monorepo with NestJS backend + Next.js frontend

Status: Accepted
Date: 2026-07-27

## Context

The predecessor WordPress plugin entangled domain logic, payment integrity, and PMS sync inside the WordPress/PHP runtime for a single tenant, which produced concurrency workarounds instead of a designed state machine/queue, and had no path to multi-tenancy. The Clock PMS+ integration brief (`docs/source/clock-pms-integration.pdf`) independently specifies a modular-monolith backend in TypeScript/NestJS with PostgreSQL, Redis, and BullMQ, plus a React/Next.js frontend, explicitly to avoid building MUST as a "Clock wrapper."

## Decision

- Single monorepo (`apps/api`, `apps/web`, `apps/booking-widget`, `packages/*`).
- Backend: TypeScript, Node.js LTS, NestJS, PostgreSQL, Redis, BullMQ, OpenAPI, runtime validation.
- Frontend: React/Next.js, TypeScript, TanStack Query, React Hook Form.
- The WordPress plugin becomes a thin embeddable client of the backend's public API; it is not part of this monorepo's application logic.

## Consequences

- One deployable backend service (modular monolith with workers), not microservices, at least through initial multi-tenant + billing + Clock adapter delivery. Revisit only if a concrete scaling or team-ownership reason emerges.
- Shared TypeScript types/contracts between backend and frontends via `packages/shared-types` and `packages/domain-contracts`.
- PMS vendors (Clock first) are implemented behind a `PmsProvider` interface; the booking domain never imports a vendor SDK directly.

## Alternatives considered

- Continuing to extend the WordPress plugin: rejected — it is the root cause being fixed (see `PROJECT_CONTEXT.md`).
- Microservices from day one: rejected as premature for current team size and unproven load; the modular-monolith-with-workers structure keeps service boundaries internal and revisitable.
