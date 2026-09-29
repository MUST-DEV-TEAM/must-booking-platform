# Audit coverage ledger

Updated 2026-09-27 for MBA-AUDIT-002. This is a reconciliation of existing audit documents only. It does not verify product behavior, accept findings, or certify runtime, deployment, provider, browser, or accessibility behavior.

## Record reconciliation

The four detailed reports contain **43 distinct finding headings**: 19 root records in [FINDINGS](FINDINGS.md), 8 security/data records in [SECURITY_DATABASE_AUDIT](SECURITY_DATABASE_AUDIT.md), 11 UI/UX records in [UI_UX_AUDIT](UI_UX_AUDIT.md), and 5 operations records in [OPERATIONS_AUDIT](OPERATIONS_AUDIT.md). This matches the 43-record total in [AUDIT_STATUS](AUDIT_STATUS.md) and [HANDOFF](HANDOFF.md). The 24 worker records are linked from the central register; the 19 root records follow it in the same file. These are records, not accepted defects.

The current queue contains 92 unique units: the original 001–048 plus 44 bounded documentation reads 049–092. Live status is maintained in [INVESTIGATION_QUEUE](INVESTIGATION_QUEUE.md); these are evidence/review tasks, not finding counts or product milestone completion.

Accepted planning reports [042](investigations/MBA-AUDIT-042.md), [043](investigations/MBA-AUDIT-043.md), [044](investigations/MBA-AUDIT-044.md) and [045](investigations/MBA-AUDIT-045.md) map exact remaining or uncertain document ranges. Reads [049](investigations/MBA-AUDIT-049.md), [050](investigations/MBA-AUDIT-050.md) and [051](investigations/MBA-AUDIT-051.md) cover the full 57-line webhook document, 67-line endpoint matrix and M21 lines 1–113. They classify documented claims and supersessions without fresh source/provider/deployment verification. Heading inventories alone do not certify body coverage. Routing indexes and the already-read financial plan are excluded from duplicate dispatch.

[007](investigations/MBA-AUDIT-007.md) and [008](investigations/MBA-AUDIT-008.md) challenge MBA-012/014/016 with source tracing and offline real-service probes. They establish local branches/arithmetic with fake dependencies and source status/allocation semantics, not settlement, SQL commit or remote duplication. The non-first-child cancellation refund omission is source-traced only.

## Existing coverage, as reported

| Report | Coverage claimed in that report | Evidence boundary |
| --- | --- | --- |
| [FINDINGS](FINDINGS.md) | Root path tracing for booking/money, Clock, connection identity, notifications/reports; 19 detailed records; interrupted leads retained separately | Root assertions are source claims. Runtime effects, exploitability and provisional severity still need targeted review. MBA-AUDIT-003 is the first challenge to MBA-001. |
| [SECURITY_DATABASE_AUDIT](SECURITY_DATABASE_AUDIT.md) | ADRs 0001-0031, data/access, roadmap index, completed Milestones 1/2/8; auth, guards, capabilities, tenancy, platform admin, guest merge, schema/migrations, integration credentials and media | Eight records; 013 accepts narrowed 101/102/107; 014 accepts 104 and policy-qualifies 100/103. Two isolated existing guest tests passed, not the disputed cases. No live security test, deployed RLS/schema verification or real account creation. 105/106 still await focused challenges. |
| [UI_UX_AUDIT](UI_UX_AUDIT.md) | Next route families and principal screens, shared shell/primitives, WordPress bootstrap/config/client, booking funnel, settings/updater; screen inventory and strengths | Eleven source-backed worker records. No visual/browser/mobile/accessibility certification, installed WordPress/PHP runtime verification, or production behavior. Long milestone/archive reading remains partial. |
| [OPERATIONS_AUDIT](OPERATIONS_AUDIT.md) | CI and plugin release workflows, containers, deploy/drift/webhook/alert scripts, API bootstrap/health/observability/workers, test hooks/config, operations guide and Milestone 14 | Five source-backed worker records and retained initial commands/results. No current-host, backup/restore, external alert, branch-protection, load or deployment verification. |
| [PROJECT_MAP](PROJECT_MAP.md) | Application/infrastructure, domain boundaries, principal flows and product questions preserved from prior investigation | A navigation aid, not a fresh source inspection or an independent certification. |

Prior root coverage is summarized in AUDIT_STATUS: booking and payment paths, Clock lifecycle/recovery paths and reference docs, security/data paths, frontend workflows, operations, and reports/notifications. The report names specific documents and path families but is not a complete file-by-file manifest. Do not convert these summaries into claims that every route, line, historical document, or acceptance criterion was inspected.

## Retained checks versus reported work

The surviving evidence is summarized in [CHECK_EVIDENCE](CHECK_EVIDENCE.md) and the checks section of OPERATIONS_AUDIT:

- Retained exact command outcomes: API and web non-emitting TypeScript checks and root ESLint passed (exit 0); the initial API source test selection failed because two Redis-dependent files could not connect to localhost Redis; the initial web test run failed in walk-in booking tests after a timeout/cascade. These are not clean full-build or browser acceptance results.
- Retained behavioral probe: an in-memory real QuoteService signing/validation probe exited 0 and showed a two-adult order-shape mismatch when occupancy was omitted. It supports the narrow MBA-003 validation claim; it did not create an order or exercise database checkout.
- Worker-reported but not independently retained: bounded API rerun (45 files/306 tests passed), targeted walk-in rerun (6/6), and production dependency audit/advisory details. Exact commands or raw output/artifacts are absent; CHECK_EVIDENCE correctly treats them as reports to recover, not verified passes or release blockers.
- Source inspection, static searches, mocked/unit tests, local integration tests, provider sandbox results, browser observations, and production observations are different evidence classes. Existing claims do not establish the latter classes where explicitly absent.

## Incomplete IDs and register references

No additional finding should be inferred from these references:

- MBA-211/212 are reserved, unreviewed leads; MBA-212 is also used in the UI screen inventory for non-actionable Needs Attention/notification items. No full record exists. Astra assigned 212 to unit 033; 211 remains reserved pending recovery of its intended claim. Neither counts among the 43.
- MBA-217 appears in the UI inventory for placeholder privacy/terms pages without a full record. Astra preserved it as a NEEDS VERIFICATION lead in FINDINGS and assigned it to unit 038. It is not an accepted finding.
- MBA-305 is reserved for unverified dependency-advisory evidence; MBA-306-308 are reserved for three reported operations leads. None has a complete finding record. MBA-AUDIT-019/020 own the bounded recovery paths.
- MBA-399 appears only in OPERATIONS_AUDIT's broad ownership-range statement (300-399); no record exists. Actual detailed records are 300-304. The range statement should not be read as 100 pending findings.
- MBA-199 appears only as the upper bound of the security report's ownership range; actual detailed records are 100-107.

The 43 existing worker/root records use IDs 001-019, 100-107, 200-210, and 300-304. Repeated mentions and queue outputs are cross-references, not duplicate records. The central table links 24 worker records; root records 001-019 are detailed below that table rather than separate table rows.

## Remaining documentation chunks

Planning rows 042–045 are complete and generated the following exact units. Read only assigned remaining or explicitly uncertain portions and persist coverage; no broad source reread is implied.

| Existing queue row | Required bounded leaf dispatches |
| --- | --- |
| 042, current Clock/task docs | 049–053: 049–051 complete; two remaining M21 sections are units 052/053. Detailed ranges and questions are in the queue/report. |
| 043, catalog and booking history | 054–058: catalog and completed M3/M4/M5/M10. Completed-index routing was already consumed and is not another unit. |
| 044, WordPress milestone/history | 059–082: completed M6/M7/M9, active M13 and 14 non-index predecessor documents, split at bounded sections where needed. |
| 045, Clock/operations history | 083–092: completed M0/M11/M11.5/M12, four selected Clock archives and two sections of unverified-origin M20. The already-read financial plan is excluded. |

Every generated unit now names its file and range. Use the queue for current statuses; neither a historical Done label nor a document read establishes current behavior.

## Suggested bounded order

MBA-AUDIT-003–008/013/014 are complete and reviewed without duplicate records or claims of database/provider outcomes. Next substantive priority is 016 (FK/RLS backstops); 015 requires 012, while 009–012 remain queued for snapshots/Clock/connection identity. For operations run 018–022 in dependency order; UX/product 023–041 reuse the existing screen inventory and domain results. Planning 042–045 and reads 049–051 are complete. Luna can begin 052 alongside 016, subject to the maximum of two workers. Reads 052–092 remain NOT STARTED until separately examined.
