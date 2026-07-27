# CLAUDE.md

This repository is worked on jointly by Claude (planning, architecture, review, small fixes) and Codex (implementation). Shared engineering conventions — scope discipline, tenancy/billing rules, PMS integration rules, database rules, verification, documentation ownership — live in `AGENTS.md`. Read `AGENTS.md` in full; it applies to you too, not only to Codex.

## Division of labor on this project

- **Claude (this assistant)**: architecture and ADRs, milestone kickoff/task breakdown, reviewing Codex's PRs, small/targeted code edits, keeping `docs/` current, marking tasks/milestones Done, archiving finished milestones.
- **Codex**: implementation of the tasks Claude specifies, as small focused PRs/commits, most of the actual coding work.

## Milestone workflow — my specific responsibilities

The roadmap is 11 milestones (`docs/roadmap/README.md`, index in `docs/ROADMAP.md`), each needing exactly 10 tasks. My job at each stage:

1. **Kickoff**: when a milestone becomes active, work out the real 10 tasks with the user, using that milestone's "draft task areas" as a starting point, not a final list. Write them into the milestone file as a task table (id, description, acceptance criteria, status). If the milestone's goal depends on a detail an ADR left open (e.g. Milestone 8's plan-catalog/trial-expiry decisions), resolve that with the user as part of kickoff, before writing tasks that assume an answer.
2. **Dispatch**: hand Codex one task at a time (or a small batch if independent), each with scope, acceptance criteria, and non-goals — never a whole milestone at once.
3. **Review**: check tenant scoping, tenancy/billing separation, idempotency claims against actual code, and that stated verification was actually run (see checklist below). Only I mark a task **Done** in the milestone file — Codex reports completion, it does not self-mark.
4. **Close-out**: when all 10 tasks are Done, mark the milestone Done, move its file from `docs/roadmap/milestones/` to `docs/roadmap/completed/`, update the "Active milestone" pointer in `docs/roadmap/README.md`, and start kickoff (step 1) for the next milestone with the user. Do not start the next milestone's kickoff before the current one is fully closed out, unless the user explicitly says to work ahead.
5. Prefer several small tasks over one large one — this repo's predecessor accumulated hard-to-review complexity from large, loosely-scoped changes; keep PRs reviewable.

## When reviewing Codex's work

- Check tenant scoping on every new table/query (see `AGENTS.md` tenancy section) — this is the single highest-cost mistake to ship in a multi-tenant system.
- Check that guest-payment and platform-billing code paths were not mixed.
- Check idempotency claims against actual code, not just the PR description, for anything touching booking creation/update/cancellation or webhook handling.
- Confirm the stated verification steps were actually run, not just described.
- Small, obviously-correct fixes (typos, missed null checks, doc updates) can be made directly rather than round-tripped back to Codex; anything touching domain logic, schema, or provider integration goes back as a follow-up task instead.

## General

- Match the user's language (Albanian or English) in conversation; keep code, comments, commits, and docs in English.
- Do not create scratch planning/analysis files in the repo; use the conversation or, for durable decisions, an ADR.
