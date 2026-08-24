# MUST Booking Platform — Agent Instructions

## Repository purpose

Multi-tenant SaaS hotel booking platform with PMS integration (Clock PMS+ first) and platform subscription billing. Work only inside this repository's scope unless the user explicitly expands it.

## Start every task

1. Read this file.
2. Read `docs/INDEX.md` and read only the canonical documents it routes you to for your task. Do not load all documentation by default.
3. Run `git status --short` before editing and preserve unrelated changes.
4. Check `docs/decisions/README.md` — if your task touches a decision marked open/not-yet-accepted, stop and flag it instead of guessing; do not implement against an unresolved ADR.
5. Confirm the task you were given is a task listed in the **active** milestone's file under `docs/roadmap/milestones/` (see "Milestone/task workflow" below). If it isn't, stop and flag it rather than improvising scope.
6. Verify behavior in current code before changing it — docs are navigation, not a substitute for reading the code.

## Milestone/task workflow

Work is organized as 16 milestones, numbered 0 to 15 (`docs/roadmap/README.md`), each with its task list defined at that milestone's kickoff. **The number of tasks per milestone varies** — it is whatever that milestone's scope actually needs, not a fixed count. Milestone 6 ran to 51 tasks, Milestone 9 to 30, Milestone 12 to 25, Milestone 13 to 32. A high task number is not a sign something is wrong: if the active milestone's table lists Task 27, Task 27 is a real task. Trust the table, not a remembered count.

- Only work on tasks that exist in the active milestone's task table. Do not start a task from a future milestone, and do not invent a task not in the table, even if it seems like an obvious next step — flag the gap instead.
- You implement; you do not mark a task or milestone **Done**. Report what you did per the "Final response" format below and let Claude review and update the milestone file's status.
- If a task's acceptance criteria are ambiguous or the task depends on a detail an ADR left unspecified (e.g. a "confirm at Milestone 8 kickoff" note), stop and flag it rather than guessing the missing decision.
- Keep PRs scoped to one task. Do not bundle multiple tasks into one PR unless explicitly told to.

## Scope and safety

- Keep changes minimal and task-scoped. Do not perform unrelated refactoring.
- Never discard, reset, overwrite, or silently absorb unrelated user work.
- Do not create task reports, completion reports, scratch plans, diaries, or ad hoc Markdown files. Implementation history belongs in Git; durable knowledge belongs in the canonical doc from `docs/INDEX.md`.
- Before removing a file, check runtime wiring, module registration, migrations, tests, and any deployment/CI use of it.

## Tenancy and billing — do not conflate

- Every domain table, credential, cache key, and queue message must carry `tenant_id` (and `property_id` where applicable). Never write a query or migration that omits tenant scoping.
- Platform billing (tenant → MUST subscription) and guest payments (guest → hotel, Stripe/PokPay/Clock folio) are separate domains with separate data models and ledgers, per `docs/PROJECT_CONTEXT.md` and `docs/BILLING.md`. Never share a table, entity, or code path between them.

## PMS integration conventions (Clock PMS+ first)

- The booking domain talks only to the `PmsProvider` interface (`docs/ARCHITECTURE.md`). Never import a vendor SDK or call a vendor HTTP endpoint from domain/application code — only from the adapter's infrastructure layer.
- Do not invent Clock endpoints or fields beyond `docs/source/clock-pms-integration.pdf` and the official docs it references. Classify every assumption as `CONFIRMED_BY_DOCS`, `CONFIRMED_IN_SANDBOX`, `CONFIRMED_BY_CLOCK_SUPPORT`, `ASSUMPTION`, or `NOT_SUPPORTED` (brief section 39). Nothing marked `ASSUMPTION` goes to production without verification.
- Booking creation, updates, cancellation, webhook processing, and reconciliation must be idempotent. Do not blind-retry booking creation on timeout — check the operation record and search Clock by MUST reference first (brief sections 18-19).
- Do not make live requests to Clock, Stripe, PokPay, or any external provider (including read-only probes) without explicit approval.

## Database

- Schema changes are additive or come with an explicit migration + rollback plan.
- Migrations must be idempotent and safe to re-run.
- Monetary values use `NUMERIC` or minor units — never floating point.
- Every new table needs its tenant-scoping and constraint story reviewed against `docs/TENANCY.md` before merge.

## Verification before reporting done

- Run the relevant lint/typecheck/test commands for whatever you changed (backend: NestJS/TS build + unit tests; frontend: build + tests). Do not claim a check passed without having run it.
- Do not call a test behavioral if it only inspects source text.
- `git diff --check`, review `git diff --stat`, confirm the final file scope matches the task.

## Canonical documentation ownership

See `docs/INDEX.md` for the full routing table. Update the owning document when a task changes durable knowledge; do not duplicate facts across documents. Significant, cross-cutting, or hard-to-reverse decisions require an ADR in `docs/decisions/` before implementation — do not create an ADR for routine implementation detail.

## Final response

Report:

- Which milestone/task number(s) this addresses (e.g. "Milestone 1, Task 3").
- Files changed.
- What changed and why.
- How to test it.
- Checks run and their exact results.
- Risks / follow-up.
- Docs updated or explicitly not updated (and why).
