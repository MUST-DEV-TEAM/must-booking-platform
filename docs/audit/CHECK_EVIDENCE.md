# Audit check evidence

Preserved 2026-09-27. Exact initial commands/results: [OPERATIONS_AUDIT](OPERATIONS_AUDIT.md#checks). Do not rerun completed checks just to populate this file.

## Retained results

- API/web non-emitting typechecks and root ESLint: PASS, each exit 0.
- Initial API src selection: FAIL exit 1; 45 files passed/2 failed, 306 tests passed/4 failed/8 skipped. Two files require Redis; localhost refused. Harness/resource failure, not a business defect.
- Initial web run: FAIL exit 1; 37 files passed/1 failed, 136 tests passed/5 failed. First walk-in timeout may cascade; not a confirmed product defect.
- No clean production build, migration, provider/database acceptance or browser acceptance claimed.

## Direct quote probe

Root ran an in-memory real QuoteService via pnpm --filter api exec tsx -e, with encoded JavaScript argument transport. Pricing alone returned constant EUR 100.00 for 2027-06-01 to 2027-06-02; actual signing/validation ran without DB/provider construction.

One- and two-adult quotes were validated with the exact expected-field shape from MultiRoomBookingService (occupancy omitted). Exit 0:

```json
{"oneAdultOrderValidation":null,"twoAdultsOrderValidation":{"code":"QUOTE_MISMATCH","message":"The booking does not match the quoted stay or price."},"changedGuestCountNotPassedToValidator":8}
```

The last field is a probe annotation, not proof that an eight-guest booking was inserted. Supports MBA-003's validator mismatch, not full group/database behavior.

## Reports before worker interruption: incomplete artifacts

| Worker report | Evidence still needed |
| --- | --- |
| Bounded API rerun: 45 files/306 tests passed | Exact exclusions/worker command and output |
| Targeted walk-in rerun: 6/6 passed | Exact command/output; initial contention suspected |
| pnpm audit --prod exit 1: 15 advisories, 2 critical/10 high/2 moderate/1 low | Audit JSON, lockfile paths, applicability |
| Reported Next 16.2.11/sharp 0.35.3; GHSA-2xp9-vwfh-vxw4 and Windows-specific GHSA-p293-qw3h-jr36 | Official advisory provenance, patch versions, active paths and target OS |

These are preserved worker reports, not independently verified passes/release blockers. No compromised-host claim. MBA-AUDIT-018/019 recover or narrowly verify missing evidence.

## Orchestration checkpoint validation, 2026-09-27

Documentation-only validation after units 001-003 and Astra adjudication:

- Python stdin validator over all 21 audit Markdown files: PASS, exit 0. Checked 74 local links (including heading anchors), 116 full-path source citations for file existence and starting-line bounds, 43 distinct record headings and 48 sequential queue IDs. Zero missing links/anchors, citation bounds errors, trailing-whitespace lines or matches for the checked secret patterns. These are document-integrity checks, not proof that every cited line establishes its associated claim.
- The first validator run caught two stale citations and undercounted records because it accepted only second-level headings. Luna checked the two cited source files and corrected the references; the validator was corrected to accept the existing heading levels, then rerun successfully. No finding was added or accepted by that citation repair.
- `git diff --check -- docs/audit`: PASS, exit 0. Audit files remain untracked, so this command alone cannot validate their contents; the direct text checks above cover them.
- Full `git diff --check`: PASS, exit 0; no whitespace diagnostics, 42 existing CRLF conversion notices only. Final status still has 92 changed tracked paths and the untracked audit directory.
- `git diff --stat`: exit 0; reviewed the 92 pre-existing tracked changes (1,883 insertions, 4,572 deletions) separately from the untracked audit directory. This work period edited only audit documentation.
- No product build, test suite, database or provider check rerun for this documentation checkpoint. Prior product-check outcomes and limitations remain recorded above.

To repeat documentation verification, scan all audit Markdown local targets/anchors, source-citation paths and line bounds, unique finding/queue IDs, whitespace and credential-pattern matches; inspect any failures before accepting the checkpoint. Secret-pattern absence is not a complete secret audit.

## Continuation checks: units 004–006/042/043, 2026-09-27

- Sol recorded `pnpm exec vitest run src/payments/stripe-payment.provider.spec.ts` from `apps/api`: PASS, exit 0; one file, four tests passed. These are existing focused unit tests with mocked outbound calls, not database or actual Stripe acceptance. Exact worker evidence is in investigation 004; Astra did not rerun it.
- Investigation 004 retains the full PowerShell/Node command for an offline probe using the real Stripe provider/controller and installed SDK with synthetic process-local credentials and fake dependencies: exit 0. A locally signed paid payload carrying deliberately unrelated mode/amount/currency/environment/reference reached the fake payment handler once; the unpaid variant did not add a call; tenant-credential reads were zero. It establishes local missing checks, not Stripe issuance or a committed charge.
- The unit configuration contains timeouts only and registers no global/setup hooks (Astra inspected `apps/api/vitest.config.ts`). No Nest bootstrap, database, Redis or live provider activity is claimed for the probe. The worker's substantive report was saved before its final follow-up hit a usage limit.
- Unit 005 reused the saved real QuoteService result; it inspected relevant stubbed integration tests without rerunning them. Its resumed worker confirmed no material source evidence was pending and checked 18 full-path source citations for existence/starting-line bounds, with zero trailing whitespace.
- Units 042/043 were documentation dispatch planning. They created no product findings and ran no product tests. Their notes disclose incidental historical text exposed during discovery; this is not recorded as systematic document coverage.
- Unit 006 inspected cancellation/hold source and existing tests without executing tests or a new probe. Sol checked 36 shorthand source citations against a full-path legend: files and cited range endpoints resolve; zero trailing whitespace, final newline present and no NUL. Runtime counter effects and provider behavior remain unverified.
- Final direct audit-document validator: PASS, exit 0; 26 Markdown files, 77 local links/anchors, 147 full-path citation existence/starting-line checks, 43 distinct finding records and 58 sequential queue IDs. Zero link/bounds/record errors, trailing-whitespace lines or matches for selected secret patterns. Counts describe document integrity, not verified business behavior.
- Final `git diff --check`: PASS, exit 0, no whitespace diagnostics; 42 pre-existing CRLF conversion notices only. `git diff --stat`: exit 0, still 92 pre-existing tracked changes / 1,883 insertions / 4,572 deletions. The SHA-256 aggregate of all 844 tracked paths outside docs/audit matched the start-of-continuation baseline exactly; no tracked product or canonical-document content changed during this work period. Audit reports remain untracked and were checked directly.

## Refund continuation: units 007/008/044/045, 2026-09-27

- [Unit 007](investigations/MBA-AUDIT-007.md) retains the exact PowerShell/Node command and output for the real refundCharge method with fake provider/transaction dependencies. Corrected probe: PASS, exit 0. Pending success attempted a payment INSERT and produced audit/in-app completion effects; explicit refusal produced none. The stub labels the write, while source establishes the REFUNDED literal. No guest row was returned, so no confirmation email was produced; a Clock candidate is not an executed mirror. The first probe attempt failed from a wrapper-property error and is disclosed in the note.
- [Unit 008](investigations/MBA-AUDIT-008.md) retains the exact command and output for real manualRefund/record methods with fake SQL results. Corrected probe: PASS, exit 0. Supplied 40/60 charges yielded refund 60 followed by REFUND_NOT_AVAILABLE; two supplied sibling projections each permitted a 100 local record. The first draft failed before execution because of PowerShell argument quoting. These are service branch/arithmetic checks, not real locking, RLS, HTTP authorization, commit or financial settlement. The separate cancellation-through-child-two case is source-traced only.
- No existing test suite was rerun for these units; inspected e2e examples do not cover the disputed cases. The manual transaction's exact effective timeout was not measured: source uses no per-call override and its comment describes a default, which is not live timing evidence. Pending/unknown refunds remain reserved against repeat attempts until resolved; that reservation is not itself an allocation defect.
- Planning [044](investigations/MBA-AUDIT-044.md) and [045](investigations/MBA-AUDIT-045.md) verified 24 and 10 proposed file ranges respectively, each within its file and at most 250 lines. They ran no product tests and established no historical behavior. Prior routing/financial-plan coverage was reused.
- Final direct document validator: PASS, exit 0; 30 Markdown files, 92 local links/anchors, 163 full-path citation existence/starting-line checks, 43 unique finding records and 92 sequential queue IDs. Zero errors, trailing-whitespace lines or selected secret-pattern matches. A separate table/range check passed: all 92 queue rows are contiguous and all 44 generated reading ranges resolve within their files and the 250-line cap.
- Final `git diff --check`: PASS, exit 0; no whitespace diagnostics, 42 existing CRLF conversion notices only. `git diff --stat`: exit 0; the same 92 pre-existing tracked changes / 1,883 insertions / 4,572 deletions. SHA-256 aggregation of all 844 tracked paths outside docs/audit matches the starting baseline exactly. New audit files are untracked and were checked directly; these checks do not certify business behavior or exhaustive secret absence.

## Authentication and authorization continuation: units 013/014/049–051, 2026-09-27

- [Unit 013](investigations/MBA-AUDIT-013.md) challenged the auth/recovery/invitation source, guards and nearby tests. No runtime attack, account creation, Redis/SQL test or application boot ran. Its Prettier check exited 0; 19 full-path source references existed and the selected credential-pattern scan returned no matches. Single-token entropy/GETDEL, signup limits and invitation role/seat constraints are counterevidence, not proof of complete recovery or identity binding.
- [Unit 014](investigations/MBA-AUDIT-014.md) ran `pnpm --filter api exec vitest run src/tenancy/guests.service.spec.ts`: PASS, exit 0; one file, two tests passed, Vitest 3.2.7, 2.13 seconds reported duration. Configuration and test dependencies were inspected first. These existing fake-dependency tests cover candidate-as-canonical and dismissal; they do not reproduce flagged-as-canonical rejection, cross-property authority, mapping transfer/collision or real RLS/SQL. Astra reviewed the result without rerunning it. The real-DB/AppModule e2e was not run. Its Prettier and scoped whitespace checks passed; 23 full source paths existed.
- Documentation reads [049](investigations/MBA-AUDIT-049.md), [050](investigations/MBA-AUDIT-050.md) and [051](investigations/MBA-AUDIT-051.md) covered 57 webhook lines, 67 endpoint-matrix lines and M21 lines 1–113 respectively. They retain dated provider/test/deployment claims and supersessions as attributed evidence. They performed no fresh product tests or external calls, and do not certify historical Done labels.
- Root adjudication accepts MBA-101/102/104/107 as bounded source findings. MBA-100's intended suspension boundary remains a QUESTION; MBA-103's excessive-authority claim remains LIKELY pending reviewer policy. Neither policy-dependent record is an unconditional accepted HIGH authorization defect. No new finding IDs, product changes or product milestone updates.
- `git diff --check`: PASS, exit 0, no whitespace diagnostics; 42 existing CRLF conversion notices. `git diff --stat`: exit 0, unchanged 92 pre-existing tracked paths / 1,883 insertions / 4,572 deletions. The aggregate of all 844 tracked paths outside docs/audit matches the starting SHA-256 `b39fa840e884baa911c333c9e72def92aa08c836f56cc91507c2f0dd04df6fe2`. Reproduction: sort Git tracked paths excluding docs/audit; hash each UTF-8 path, a NUL byte, then that file's raw SHA-256 digest or literal MISSING if absent, into one SHA-256 stream. This covers tracked content only; new audit files remain untracked and require direct checks.
- Final direct document validator: PASS, exit 0; 35 Markdown files, 113 local links/anchors, 211 full-path citation existence/starting-line checks, 43 distinct records and 92 sequential queue IDs. Zero missing links, citation-bound errors, trailing-whitespace lines or selected secret-pattern matches. `pnpm exec prettier --check` over the 13 changed audit files: PASS, exit 0. Files: FINDINGS, SECURITY_DATABASE_AUDIT, QUESTIONS, AUDIT_STATUS, HANDOFF, INVESTIGATION_QUEUE, COVERAGE_LEDGER, CHECK_EVIDENCE and investigation reports 013/014/049/050/051. These are documentation-integrity checks, not full secret detection or semantic proof of every citation. Product builds and broad suites were not rerun for this audit-only checkpoint.
