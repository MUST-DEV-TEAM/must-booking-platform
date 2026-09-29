# QUESTIONS

Audit in progress. These are bounded policy questions supported by reviewed source evidence, not implementation instructions or newly accepted defects. Other domain questions remain to be synthesized.

| Related record | Decision needed | Why it matters / evidence boundary |
| --- | --- | --- |
| MBA-100 | What does tenant suspension block: staff access, new guest bookings, existing-guest actions, background jobs, or some combination? Which refunds, callbacks and reconciliation must continue? | ADR-0021 authorizes suspend/reactivate but does not define admission semantics. The action persists/audits status while inspected entry guards ignore it. HIGH access-control severity is conditional on the intended contract. |
| MBA-103 | May staff assigned to one property approve tenant-wide guest merges/dismissals and see both profiles in a shared duplicate pair? If delegated review is allowed, what scope and disclosure limits apply? | Guests and complete identity merges are intentionally tenant-wide under ADR-0030. The property capability gate does not settle who may exercise that authority. Do not repair this by partially moving only one property's booking references. |
| MBA-104 | How should merge resolve two different Clock guest mappings for the same property, including provenance and any required manual review? | Canonical-choice rejection and omitted mapping preservation are accepted source defects. Unique local/external mapping constraints make blind reassignment insufficient when both profiles already have mappings. Actual SQL collisions and provider outcomes are unverified. |
| MBA-106 | What audit-log retention and parent-reference behavior should apply when an organization is deleted? | The migration chain drops the former tenant parent FK with CASCADE and does not restore it. Missing integrity checks are verified source behavior; automatically restoring that cascade could erase logs whose intended retention has not been established. |

Evidence and counterevidence: [authorization investigation](investigations/MBA-AUDIT-014.md), [constraint investigation](investigations/MBA-AUDIT-016.md) and [security/data records](SECURITY_DATABASE_AUDIT.md). These questions do not block unrelated audit work and do not authorize changing accepted product decisions.
