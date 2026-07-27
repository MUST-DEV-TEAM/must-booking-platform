# Documentation Index (task router)

Read only the documents routed for your task. Do not load the whole `docs/` tree by default.

| Task type | Read |
| --- | --- |
| Understand product scope, tenancy, billing, status | `PROJECT_CONTEXT.md` |
| System architecture, module boundaries, stack decisions | `ARCHITECTURE.md` |
| Tenant model, isolation, roles | `TENANCY.md` |
| Platform subscription billing (plans, metering, invoicing) | `BILLING.md` |
| Clock PMS adapter work | `source/clock-pms-integration.pdf`, and once created: `CLOCK_ARCHITECTURE.md`, `CLOCK_ENDPOINT_MATRIX.md`, `CLOCK_DATA_MAPPING.md` (see ROADMAP phase 2) |
| Delivery order / what to build next | `ROADMAP.md` (milestone index), then `roadmap/README.md` (process) and the active milestone file under `roadmap/milestones/` |
| Durable, cross-cutting, or hard-to-reverse decisions | `decisions/` (ADR log) |
| Notable changes | `../CHANGELOG.md` |

## Canonical document ownership

Each durable fact has exactly one home. When a task changes durable knowledge, update the owning document — do not duplicate the fact elsewhere.

- Product scope/status → `PROJECT_CONTEXT.md`
- Architecture/module boundaries/data flow → `ARCHITECTURE.md`
- Tenant/isolation model → `TENANCY.md`
- Billing model → `BILLING.md`
- Durable decisions → `decisions/ADR-XXXX-*.md`, indexed in `decisions/README.md`

Significant, cross-cutting, high-risk, or difficult-to-reverse decisions require an ADR before implementation. Do not create ADRs for routine implementation detail.
