# MUST Booking documentation

MUST is a multi-tenant hotel booking platform: a NestJS API owns booking and guest payments; a Next.js app serves tenant staff and platform administrators; a WordPress plugin presents the guest journey. PostgreSQL stores business records, Redis supports sessions, rate limits and BullMQ jobs, and Clock PMS+ is the implemented external PMS adapter. Subscription billing has a Free-plan foundation but no paid subscription implementation.

**Evidence baseline: repository inspected 2026-09-19.** Current documents describe checked-in code, not a certification of the deployed service. Dated live-test claims are preserved as historical evidence and were not rerun during initialization.

## Find the right source

| Question | Read | Authority |
| --- | --- | --- |
| Product scope, implemented versus planned | [Product overview](product-overview.md) | Current capability boundary |
| Applications, modules, provider boundaries | [Architecture](architecture/overview.md) | Current wiring and source map |
| Schema, RLS, authentication, roles | [Data and access](architecture/data-and-access.md) | Current data/security architecture |
| Availability, quotes, bookings, payments, refunds | [Booking and payments](architecture/booking-and-payments.md) | Current domain flows |
| Next.js, WordPress, API entry points | [Frontends and API](architecture/frontends-and-api.md) | Current client/server contracts |
| Free plans versus paid subscriptions | [Platform billing](architecture/platform-billing.md) | Implemented foundation and accepted future intent |
| Clock behavior, endpoints, mapping, jobs, recovery | [Clock architecture](integrations/clock/architecture.md) | Current adapter; links to contract evidence and runbook |
| Setup, tests, deployment, observability | [Operations and testing](operations/README.md) | Source-backed procedures and deployment limits |
| Why a decision was made | [ADR index](decisions/README.md) | Accepted intent and supersession history |
| What to plan or implement next | [Roadmap](roadmap/README.md) | Task authorization, review state and backlog |
| Visual design and tokens | [Design system](design/design-system.md) | Design intent; implemented inventory is explicitly separate |
| Original Clock requirements | [Reference material](source/README.md) | External/source requirements, not implemented features |
| Old plans, reports, completed work | [Archive](archive/README.md), [completed milestones](roadmap/completed/README.md) | Historical evidence, not current behavior |
| Old filenames or a document's classification | [Documentation catalog](catalog.md) | Maintained inventory and migration map |
| How to plan, review and maintain docs | [Working agreement](maintenance.md) | Owner/Claude roles and documentation rules |

## Read efficiently

1. Read this page and the repository [agent instructions](../AGENTS.md).
2. Select the relevant document above and any applicable ADR.
3. Jump to its source paths and inspect the actual handlers/services/schema before planning a change.
4. Broaden the search only when those sources cannot answer the question. Skip dependencies, generated outputs, caches and unrelated history.

Implementation establishes **current behavior**. Schema and SQL migrations establish constraints; ADRs establish **intended rules**, including rules current code may not yet satisfy. Do not silently reinterpret a discrepancy as approval to change either. Known gaps are listed beside their owning architecture sections.

## Organization and ownership

`architecture/` explains the current system; `integrations/clock/` owns Clock-specific contracts and workflows; `operations/` routes setup/testing/deployment; `decisions/` preserves reasons; `roadmap/` owns delivery state; `design/` owns visual intent; `source/` contains original reference material; `archive/` contains superseded or unverified-origin material.

Each durable fact has one owner. Link to that owner rather than copying its prose into a plan. [INDEX.md](INDEX.md) remains a compatibility pointer only. Historical source comments may use old uppercase filenames; resolve them through the catalog.

Claude plans and implements; the owner approves plans and merges. See the [working agreement](maintenance.md).
