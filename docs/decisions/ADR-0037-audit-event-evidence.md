# ADR-0037: Explicit audit evidence and application append-only history

Status: Accepted owner direction, 2026-10-24.

The owner approved consistent outcomes, readable changes, source attribution, operation-linked evidence, protected history and logging-failure monitoring. New records may carry a versioned audit envelope in the existing details JSON: explicit outcome, source and an optional scoped operation reference. Reviewed exact event definitions supply prospective defaults only; unknown event types do not imply success. Existing rows remain immutable and absent historical outcomes remain unspecified. Business outcomes, HTTP request outcomes and provider-confirmed financial results remain distinct facts.

Lists, detail and exports use the same permission-filtered model. Only saved operation references establish operation links; same-target/time-window evidence is labelled as nearby activity. Routine synchronization may be filtered separately without hiding failed or financial events. Readable summaries never expose fields excluded by the existing capability/privacy rules.

Restrictive PostgreSQL policies prevent the application role from updating/deleting audit history while preserving its existing scoped SELECT/INSERT policies and maintenance authority. Rollback may remove only the new policies/index with an explicit access review; it never rewrites or deletes history. Before-storage redaction and generic operational logging-failure reporting supplement existing read redaction. Audit failure still aborts its local business transaction; no failed audit write authorizes retrying an external payment or provider command.

This change sets no new retention period, deletes no records and collects no IP/location/session secrets. Audit/security retention execution remains separate from ADR-0009's tenant churn rule. Production backup scheduling, restore drills and external alert delivery need deployment-specific verification; local tests cannot establish those controls.
