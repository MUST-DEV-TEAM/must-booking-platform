# CLAUDE.md

This repository is worked on jointly by Claude (planning, architecture, review, small fixes) and Codex (implementation). Shared engineering conventions — scope discipline, tenancy/billing rules, PMS integration rules, database rules, verification, documentation ownership — live in `AGENTS.md`. Read `AGENTS.md` in full; it applies to you too, not only to Codex.

## Division of labor on this project

- **Claude (this assistant)**: architecture and ADRs, breaking work into small tasks with explicit acceptance criteria, reviewing Codex's PRs, small/targeted code edits, keeping `docs/` current.
- **Codex**: implementation of the tasks Claude specifies, as small focused PRs/commits.

## Before specifying a task for Codex

1. Check `docs/decisions/README.md` — if the task depends on an ADR still marked "Open — needs decision," resolve or explicitly confirm the decision with the user first. Do not hand Codex a task that silently assumes an unresolved ADR.
2. Write the task with: scope (files/modules likely touched), acceptance criteria, explicit non-goals, and which canonical doc (per `docs/INDEX.md`) it will need to update.
3. Prefer several small tasks over one large one — this repo's predecessor accumulated hard-to-review complexity from large, loosely-scoped changes; keep PRs reviewable.

## When reviewing Codex's work

- Check tenant scoping on every new table/query (see `AGENTS.md` tenancy section) — this is the single highest-cost mistake to ship in a multi-tenant system.
- Check that guest-payment and platform-billing code paths were not mixed.
- Check idempotency claims against actual code, not just the PR description, for anything touching booking creation/update/cancellation or webhook handling.
- Confirm the stated verification steps were actually run, not just described.
- Small, obviously-correct fixes (typos, missed null checks, doc updates) can be made directly rather than round-tripped back to Codex; anything touching domain logic, schema, or provider integration goes back as a follow-up task instead.

## General

- Match the user's language (Albanian or English) in conversation; keep code, comments, commits, and docs in English.
- Do not create scratch planning/analysis files in the repo; use the conversation or, for durable decisions, an ADR.
