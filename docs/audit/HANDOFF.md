# Audit handoff

Updated 2026-09-27. Read [AUDIT_STATUS](AUDIT_STATUS.md), [INVESTIGATION_QUEUE](INVESTIGATION_QUEUE.md), then relevant findings. **Continue; do not restart.**

## Objective and rules

Comprehensive multi-session audit of Must Booking AL; only docs/audit edits. No implementation, deployment, provider probes, database changes, secret disclosure or product milestone completion. Preserve the dirty worktree.

Astra coordinates/reviews. Explicit GPT-6 Luna high for bounded inventory/evidence, GPT-6 Sol for difficult payments/security/concurrency. At most two workers; no Astra workers, former broad-agent restarts or full-history inheritance. Persist each unit.

## System and discoveries

NestJS/Prisma/PostgreSQL modular monolith with Redis sessions/limits/BullMQ and in-process workers; Next staff/platform app; WordPress guest frontend. Clock is external PMS; guest payments are separate from planned platform subscriptions. [PROJECT_MAP](PROJECT_MAP.md) holds the map.

Forty-three records preserved: MBA-001–019, 100–107, 200–210, 300–304. Mixed evidence strength, not automatic acceptance. Priority candidates: Stripe rollback/webhook binding; group checkout invariant drift; inventory cancellation; refund states/allocations; guest authorization/invite identity/SSRF. Review behavior and consequence claims separately.

Connections to keep: paid != booked != PMS confirmed != refund settled; single/group paths differ; Clock projection overwrites commercial fields; current provider assignment differs from historical transaction identity; guest UI promises can exceed backend facts; historical Done labels do not prove runtime behavior.

## Evidence already collected

Root traced paths listed in AUDIT_STATUS and read the nine-page Clock brief. Worker reports list their coverage; do not broadly reread it. UI screen inventory already exists.

Lint/API/web noEmit passed. Initial API tests: Redis-dependent failures; initial web tests: timeout with possible cascade. Workers reported bounded rerun passes/advisories before interruption but exact commands/output were not preserved. CHECK_EVIDENCE separates retained results from reports. Root's real QuoteService validation probe demonstrates missing order occupancy; it is not a full order/database test.

Unsaved leads are preserved in FINDINGS: cancellation bearer tokens in URL logs; connection deletion/cascade/fallback; mismatched connection kind/provider bypass; shutdown hooks; stale global provider health; runtime migration credentials; unhandled dead-letter writes; dependency advisories. These are not accepted new findings.

## Exact next steps

1. Units 001–008/013/014/042–045/049–051 are COMPLETE. Current continuation: 017 ACTIVE (Sol high, sensitive data/media controls) and 054 ACTIVE (Luna high, documentation catalog); 016/052/053 are now COMPLETE, at most two workers. Reconcile their notes before redispatch. Usage interruptions were resumed in the same workers; completed evidence must not be restarted.
2. Units 004/005 narrowed MBA-011 and MBA-003/004. Four focused Stripe unit tests and an offline signed-payload probe are retained in 004; 005 reused the existing occupancy probe and ran no new tests. The source findings do not prove live miscredit, committed inconsistent orders or failed expiry. Unit 005 resumed after interruption and confirmed no material source evidence pending; unit 004's saved report was reviewed without restarting its worker.
3. Accepted 013 narrows MBA-101/102/107: missing application throttles do not prove absent edge controls; reset revocation is distinct from strong single-token replay protection; invitation identity substitution/unused-email verification does not prove existing-account or mailbox takeover. Completed 014 accepts MBA-104's canonical-choice rejection and omitted Clock mapping preservation. MBA-100 is a suspension-policy QUESTION; MBA-103 is LIKELY for excessive authority pending reviewer policy, because tenant-wide Guest merges are intended. QUESTIONS captures those decisions and conflicting Clock mappings. Two existing isolated tests passed, not the disputed cases or SQL/RLS. Next security unit is 016; 015 requires 012 and is not yet ready. Completed 051 covers M21 lines 1–113; 049–051 provide document coverage without fresh provider/deployment certification. The next free ID remains 093.
4. MBA-AUDIT-002's [coverage ledger](COVERAGE_LEDGER.md) preserves unfinished references 211/212/217 and missing test artifacts; these are leads, not additional accepted findings. 033 owns 212; 038 owns 217. The number 211 stays reserved pending recovery of its intended claim.
5. Planning 042–045 is complete. Reads 049–051 are complete and 052–092 unstarted. Gate 048 depends on those reads and substantive investigation/synthesis. Document coverage is not verification of its implementation/test claims, and archived instructions do not authorize old commands or product milestone updates. In particular, M21 Phase B's historical Done label does not invalidate unit 014's current merge-source findings.
6. End each work period with durable status and a named next unit. The audit remains incomplete; no final report or product milestone completion is authorized by these audit statuses.

Latest adjudication: MBA-001 remains VERIFIED FINDING for single-booking source/control-flow rollback; its test-key statement now distinguishes checkout/refund guards from absent webhook environment checks. MBA-011 is accepted HIGH/NOW for missing checkout/payment binding; actual misuse/loss remains NEEDS VERIFICATION. MBA-003/004 are accepted HIGH with occupancy, late credential-check, atomic locking and conditional-expiry limits. MBA-005 is accepted HIGH for pooled holds owned by reachable recovery-state bookings; physical rooms, rejected cancellations and states without proven holds are separate. Focused reports 003–006 contain counterevidence; no corrective product implementation occurred.

Refund continuation: 007/008 narrowed MBA-012/014/016. The offline probes run real service methods with fake SQL/providers, not database commit or money movement. Pending success reaches an insert whose source status is REFUNDED; explicit refusal does not. Manual intent/outbound work share SQL transactions, while Stripe carries an idempotency key. Reachable manual installments can strand an older charge, sibling IDs can record multiple whole-order receipts, and non-first-child cancellation can miss the paid anchor. Preserve pending/unknown refund reservations; lost settlement state and wrong allocations are the defects, not temporary prevention of another refund.

Confidence: VERIFIED FINDING, LIKELY FINDING, NEEDS VERIFICATION, QUESTION, RECOMMENDATION. Old VERIFIED_SOURCE labels preserve worker claims, not runtime/exploit/business acceptance. Accepted ADRs still leave commercial/retention/rollout decisions unresolved. Current deployment, restore proof, provider contracts and real browser/hotel workflows remain unverified.
