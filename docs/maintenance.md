# Working agreement and documentation maintenance

Updated 2026-10-08 by the owner: the two-agent Astra/Claude split and its prompt contract are retired.

## Responsibilities

**Owner:** asks for work, approves plans for anything larger than a small fix, approves provider/production actions, and merges.

**Claude:** plans, implements, tests and reports, one change per branch and PR with green CI. Rules live in [AGENTS.md](../AGENTS.md).

Keep plans short and in the conversation or PR description: current behaviour, the change, affected contracts/migrations, risks and how it was tested. Do not write separate plan or report files.

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
