# Working agreement and documentation maintenance

Established by the owner for the 2026-09-19 initialization. This is the shared human/agent workflow, not a separate AI documentation system.

## Responsibilities

**Astra (Codex): understand, architect, plan, review.** For a future feature, fix, refactor, integration or schema request, default to a plan unless the owner explicitly asks Astra to implement. Inspect focused source before reasoning from docs. When reviewing Claude's result, compare the requested behavior, plan, actual diff and test evidence; do not automatically rewrite working code.

**Claude: implement, test, report.** Preserve established conventions, execute scoped changes and report exact evidence. Claude maintains task completion status after review; no agent should equate its own implementation claim with acceptance.

An explicit owner-authorized exception can permit out-of-table work, as with this initialization. It does not authorize unrelated product work. Production/provider operations require the task's concrete scope and applicable approval, not merely a general desire to improve docs.

## Plans and Claude prompts

A plan identifies relevant current behavior; affected modules/files; database/migration and API contracts; WordPress impact; security, concurrency, idempotency and compatibility; edge cases; tests and acceptance criteria. Mark absent/unknown inputs rather than filling them with guesses. Keep routine plans in the conversation or existing task; do not generate scratch reports.

End each implementation plan with **CLAUDE IMPLEMENTATION PROMPT**, containing the applicable sections:

```text
PROJECT CONTEXT
TASK (milestone/task or explicit exception, goal and non-goals)
CURRENT IMPLEMENTATION
ARCHITECTURAL CONSTRAINTS
RELEVANT DOCUMENTATION
FILES / MODULES LIKELY INVOLVED
IMPLEMENTATION REQUIREMENTS
DATABASE CHANGES (migration and rollback)
API / CONTRACT CHANGES
WORDPRESS CHANGES
SECURITY REQUIREMENTS
CONCURRENCY / IDEMPOTENCY REQUIREMENTS
EDGE CASES
TEST REQUIREMENTS
ACCEPTANCE CRITERIA
DO NOT DO
COMPLETION REPORT
```

Every prompt tells Claude to inspect referenced files before modifying them, preserve architecture unless the task changes it, avoid unrelated rewrites/refactors, never hide failing tests or silently change business rules, never invent missing requirements or expose secrets, and run relevant tests.

The completion report includes summary, files, migrations, contracts, tests added/changed/executed and exact results, assumptions, unresolved concerns and TODOs. If review finds defects, provide a focused **CLAUDE CORRECTIVE PROMPT** explaining only necessary corrections and verification.

## Ownership and maintenance rules

- Start at [README.md](README.md); its router assigns canonical owners.
- Update current architecture when implementation invalidates it. Give exact source paths and qualify implementation versus acceptance/deployment.
- Preserve ADR bodies as historical reasoning. Change status/add a dated supersession note and link newer decisions; do not rewrite history to make it look compliant.
- Durable cross-cutting or difficult-to-reverse decisions need an ADR before implementation; routine details do not.
- Update roadmap evidence/state when work lands. Separate implemented-but-unreviewed from Planned and Done; preserve deferrals.
- Superseded/reference material must have an obvious status banner and a link to its current owner. Archive useful history instead of deleting it.
- Prefer updating an existing owner over another Markdown file. Use [catalog.md](catalog.md) when relocating files; repair both links and plain path references.
- Use lowercase kebab-case filenames for new subject documents; retain numbered ADR names and existing milestone identities.
- Label uncertain claims **UNKNOWN / NEEDS VERIFICATION**. Preserve Clock's own evidence classifications/dates rather than inventing sandbox proof.
- Documentation-only verification: internal links/anchors, source-path existence, claim and secret-pattern review, changed-file formatting and diff/scope checks. Do not run a product's side-effecting integration suite merely to validate prose.

## Evidence boundary

Initialization inspected all documentation categories and each meaningful file's purpose/status, verified central implementation flows and sampled historical milestone claims against their source/tests. It did not certify every old acceptance criterion, rerun sandbox history, audit the live host or inspect external Figma/export state. Those limits remain explicit beside the affected material.

The catalog is an inventory/navigation aid, not a recurring completion diary. Historical filenames in source comments can be resolved there without changing executable files for cosmetic path churn.
