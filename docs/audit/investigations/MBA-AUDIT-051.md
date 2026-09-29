# MBA-AUDIT-051 — Milestone 21 scope and recorded acceptance, lines 1–113

**Scope:** Read `docs/roadmap/milestones/21-clock-certification-fixes.md:1–113` only, plus dispatch context in `AUDIT_STATUS.md`, `INVESTIGATION_QUEUE.md`, and [MBA-AUDIT-042](MBA-AUDIT-042.md). This records documented scope/status and evidence qualifications; it does not reverify code, tests, deployment, Clock behavior, or authorize historical actions. No milestone status or queue was changed.

## Scope and sequence

Milestone 21 is described as an owner-scoped Clock track, parallel to and independent of milestones 0–15 (`:3–6,8–14`). The stated order is low-risk folio/payload work, then duplicate guests and occupancy, low-priority document types, and rates last (`:16–18`). The dispatch objective is documentation classification, not product implementation (`AUDIT_STATUS.md:9,38–40`; `INVESTIGATION_QUEUE.md:61–63`; `MBA-AUDIT-042.md:17–22`).

| Phase and lines | Scope / recorded status | Qualification or supersession |
| --- | --- | --- |
| A, `:20–33` | Task 1 proposed closing deposit folios and is now **Superseded**. Task 2 (send only changed booking fields) is **Done**, verified by code inspection per its note. | September 10/16 close success was reversed by Clock’s September 18 correction: deposits must remain open; close code was removed (`:26–30`). Task 2 note says no current API caller exposes date changes (`:31–33`). |
| B, `:35–54` | ADR-0030 is recorded accepted and supersedes ADR-0015. Tasks 3 (tenant-wide phone matching/duplicate flags), 4 (Clock guest lookup), and 5 (staff merge/dismiss surface) are **Done/reviewed**. | Task 4 was corrected to attach on email match alone (`:53`), distinct from the suspected-duplicate rule (`:39–48`). Task 5 note says its real-DB e2e did not run because local AppModule boot hung on Redis/BullMQ (`:54`). |
| C, `:56–64` | Tasks 6–7 record adults/children in the model/API and send occupancy from guest/staff paths; both are **Done/reviewed**. | Task 7 explicitly lacks live sandbox booking confirmation through either entry point (`:63`); implementation and test claims do not establish Clock storage behavior. |
| D, `:65–75` | Task 8 (fiscal document type for folio close) is **Superseded**; clarification says these are billing document types, not guest identity documents (`:67–71`). | Its September 10/16 implementation and close-path evidence (`:73`) were invalidated by the September 18 open-folio correction; the helpers were deleted (`:75,87`). |
| Historical Task 9, `:77–87` | Special requests to Clock; row records **Done/live-verified 2026-09-18**, with singular `client_request` as the final field (`:77–85`). | Earlier payload forms were rejected; the final shape was probed on a disposable booking. Do not treat the intermediate plural/`active_notes` forms as contract. The September 16 close re-verification at `:87` is superseded. |
| E, `:89–113` | Meal plans are excluded. Task 9 is the rate-management kickoff; Tasks 12–13 (safe rate selection, then staff ranking) are recorded **Done**, implemented/deployed/live-verified (`:91–106,108–112`). | These are dated milestone claims, not rerun here. Task 12 uses cheapest-valid fallback; Task 13 adds per-room-type ranking that can override price and flags unranked rates (`:105–110`). |

## Qualifications and later coverage

The clearest supersession is explicit: Phase A Task 1 and Phase D Task 8 no longer describe desired behavior after the open-folio correction (`:30,75`). Phase B Task 4’s email-only attachment rule replaces its initial both-fields formulation (`:39,53`). Other “Done” labels have stated limits: no date-update caller for Task 2, no real-DB e2e for Phase B Task 5, and no live Clock acceptance for Phase C Task 7. The duplicate Task 9 number is disambiguated by title in the introductory note (`:3`); Phase D’s special-requests Task 9 is different from Phase E’s rate-management kickoff Task 9 (`:77,104`).

Units 052 and 053 own lines 114–235 and 236–269 respectively; this report makes no claim about later phases (`MBA-AUDIT-042.md:20–21`; `INVESTIGATION_QUEUE.md:62–63`). No new product finding is proposed.

## Exact coverage and checks

Read the complete assigned physical range 1–113: introduction/sequencing (1–18), Phases A–D and historical Task 9 (20–87), and Phase E through its live-verification note (89–113), including intervening blank lines and table rows. The target is 269 lines; nothing after line 113 was reviewed. Report is UTF-8 without BOM. No tests, product checks, provider calls, or historical commands were run. Checks: encoding/BOM, word count, whitespace, target line count, and cited queue/plan anchors; only this assigned report was written.

## Astra disposition, 2026-09-27

COMPLETE for documentation coverage of lines 1–113. Accept the historical scope, supersession and evidence-limit mapping; milestone Done/deployed/live-verified labels remain attributed claims. Unit 014 independently challenged the merge behavior and found current source defects despite the recorded Phase B completion. No milestone status, provider contract or deployment is certified here. Units 052/053 retain their separate ranges; no new product finding.
