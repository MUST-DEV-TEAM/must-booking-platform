// Shared provider_events status-transition SQL for ClockWebhookService
// (ingestion), ClockWorkerService (hydration worker + recovery sweep), and
// the hydration services (ClockBookingHydrationService/
// ClockFolioHydrationService) that fence their own effect-applying
// transactions. See ADR-0031 for the full design rationale.
//
// Every write here is a guarded UPDATE ... WHERE status = ANY(allowedFrom)
// [AND processing_token = $token] — concurrency-safe under Postgres's
// read-committed row locking: two concurrent UPDATEs on the same row
// serialize on the row lock, and the second re-evaluates its WHERE clause
// against the row the first one just committed, so a stale actor can never
// clobber a newer terminal outcome or resurrect a status it isn't allowed
// to write from. There is deliberately no default allowed-from list —
// every caller states exactly which prior states it may transition out of
// (a single shared default previously let a stale write resurrect FAILED).
//
// Raw SQL bypasses Prisma Client's @updatedAt middleware entirely (it only
// fires for the generated typed update methods, never for
// $executeRawUnsafe) — every transition here sets updated_at explicitly, or
// the recovery sweep's grace-period math and fairness rotation silently
// break.

export type ProviderEventStatus =
  | 'RECEIVED'
  | 'QUEUED'
  | 'HYDRATED'
  | 'IGNORED'
  | 'FAILED'
  | 'NEEDS_RECONCILIATION';

export interface GuardedTransitionParams {
  tenantId: string;
  eventRowId: string;
  status: ProviderEventStatus;
  /** Required, no default — see module doc. The write only lands if the
   * row's current status is one of these. */
  allowedFrom: ProviderEventStatus[];
  incrementAttempts?: boolean;
  /** Ownership guard: the write only lands if processing_token currently
   * equals this value — protects against a stale attempt finalizing over a
   * newer one (see ADR-0031). */
  requireToken?: string;
  /** Clears processing_token and processing_attempt (sets both NULL) — used
   * on every terminal write (`requireToken` already guards those against a
   * stale attempt, so an unconditional clear alongside a token match is
   * safe). Deliberately NOT used for job-recreation resets — see
   * `resetForJobRecreationSql`'s doc comment for why a blind clear there is
   * unsafe and what replaces it (ADR-0031, fifth corrective round). */
  clearToken?: boolean;
}

/** Returns [sql, params] for a guarded status transition. Callers execute
 * this inside their own `withTenantTransaction` and should treat a 0-row
 * result as "another actor already moved this row past the guard" rather
 * than an error — never assume the write landed just because the query
 * resolved without throwing. Never used for the worker's own claim — see
 * `claimEventSql`, which has its own combined token+generation guard. */
export function guardedTransitionSql(params: GuardedTransitionParams): [string, unknown[]] {
  const setClauses = ['status = $3::"ProviderEventStatus"', 'updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [params.tenantId, params.eventRowId, params.status];

  if (params.incrementAttempts) setClauses.push('attempts = attempts + 1');
  if (params.clearToken) setClauses.push('processing_token = NULL, processing_attempt = NULL');

  values.push(params.allowedFrom);
  const allowedFromIndex = values.length;

  let whereTokenClause = '';
  if (params.requireToken !== undefined) {
    values.push(params.requireToken);
    whereTokenClause = ` AND processing_token = $${values.length}`;
  }

  const sql = `UPDATE provider_events
     SET ${setClauses.join(', ')}
     WHERE tenant_id = $1::uuid AND id = $2::uuid
       AND status = ANY($${allowedFromIndex}::"ProviderEventStatus"[])${whereTokenClause}`;
  return [sql, values];
}

export interface ClaimEventParams {
  tenantId: string;
  eventRowId: string;
  allowedFrom: ProviderEventStatus[];
  /** This attempt's BullMQ lock token (`job.token`). */
  token: string;
  /**
   * This attempt's dispatch generation. Backed by BullMQ's real
   * `job.attemptsStarted` — verified against the installed bullmq@6
   * source (`prepareJobForProcessing.lua`'s unconditional
   * `HINCRBY jobKey "ats" 1`, the Redis field behind `attemptsStarted`):
   * it increments on **every** activation (wait/delayed -> active),
   * including a stalled job's genuine reassignment, which is exactly the
   * "is this claim newer than the current one" signal needed. Deliberately
   * NOT `job.attemptsMade` — that field only increments when an attempt
   * actually *fails*, so two overlapping activations of a job that hasn't
   * failed yet (the realistic stalled-reassignment case) can share the
   * same `attemptsMade`, which would let an obsolete attempt reclaim
   * ownership under an `attemptsMade`-based guard.
   */
  generation: number;
}

/**
 * Claims ownership of a provider_events row for one processing attempt
 * (ADR-0031). Guarded by both status (`allowedFrom`) and a combined
 * token+generation comparison:
 *   - no current claimant (`processing_attempt IS NULL`) -> always allowed
 *     (covers a fresh row and a row just reset after its old BullMQ job
 *     lineage disappeared — see `guardedTransitionSql`'s `clearToken`);
 *   - a strictly newer generation -> allowed, overwrites the claimant;
 *   - the *same* generation and the *same* token -> allowed as a no-op
 *     re-claim (idempotent — the same attempt issuing this write twice,
 *     e.g. after a transient DB error, must not be treated as a conflict);
 *   - the *same* generation with a *different* token -> rejected (two
 *     distinct dispatches should never legitimately share a generation,
 *     but if they did, neither may silently replace the other);
 *   - a strictly older generation -> rejected (the classic obsolete/late
 *     claim case this guard exists for).
 * A rejected claim affects 0 rows; callers must treat that as "do not
 * proceed," never assume the write landed just because the query resolved.
 */
export function claimEventSql(params: ClaimEventParams): [string, unknown[]] {
  const sql = `UPDATE provider_events
     SET status = 'QUEUED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP,
         attempts = attempts + 1, processing_token = $3, processing_attempt = $4
     WHERE tenant_id = $1::uuid AND id = $2::uuid
       AND status = ANY($5::"ProviderEventStatus"[])
       AND (
         processing_attempt IS NULL
         OR processing_attempt < $4
         OR (processing_attempt = $4 AND processing_token = $3)
       )`;
  return [sql, [params.tenantId, params.eventRowId, params.token, params.generation, params.allowedFrom]];
}

export interface ProcessingSnapshot {
  status: ProviderEventStatus;
  processingToken: string | null;
  processingAttempt: number | null;
}

/**
 * A plain (unlocked) read of a row's current status/ownership metadata —
 * deliberately not `FOR UPDATE`: this is the "observe before recreating a
 * missing job" snapshot (ADR-0031, fifth corrective round), taken outside
 * any transaction that spans the subsequent BullMQ `queue.add()` call, for
 * the same reason hydration's own outbound Clock fetch never runs inside a
 * lock — a Redis round-trip must never hold a Postgres row lock open.
 * `resetForJobRecreationSql` is the guarded write that later compares
 * against exactly this snapshot.
 */
export function processingSnapshotSql(tenantId: string, eventRowId: string): [string, unknown[]] {
  const sql = `SELECT status::text AS status, processing_token AS "processingToken",
       processing_attempt AS "processingAttempt"
     FROM provider_events
     WHERE tenant_id = $1::uuid AND id = $2::uuid`;
  return [sql, [tenantId, eventRowId]];
}

export interface RecreateJobResetParams {
  tenantId: string;
  eventRowId: string;
  allowedFrom: ProviderEventStatus[];
  /** The processing_token observed by `processingSnapshotSql` immediately
   * before the replacement BullMQ job was created — `null` is a valid,
   * required value (a row that was never claimed, or was already reset). */
  expectedToken: string | null;
  /** The processing_attempt observed at the same moment. */
  expectedAttempt: number | null;
}

/**
 * Resets processing_token/processing_attempt to NULL and marks the row
 * QUEUED after ingestion or the sweep creates a brand-new BullMQ job for a
 * row whose previous job's lineage had disappeared — but as a real
 * compare-and-swap against a specific prior snapshot, never a blind write.
 *
 * A blind, unconditional reset here (the design this replaces) had a real
 * bug: recreation is not one atomic step. Between "detect the job is
 * missing" and "write the reset," the newly created job's own worker can
 * already have claimed the row (`claimEventSql`, setting a fresh non-null
 * token/generation) — a blind reset arriving after that claim would
 * silently erase ownership a legitimate new attempt had already acquired,
 * un-fencing it entirely (processing_token back to NULL while that attempt
 * is still actively running). The same blind write also let two concurrent
 * recreators (e.g. a duplicate webhook delivery and a sweep tick both
 * observing "missing" for the same row) each stomp the other's effect
 * without coordination.
 *
 * The fix: only apply the reset if processing_token/processing_attempt
 * still hold *exactly* the values observed right before the new job was
 * created (`IS NOT DISTINCT FROM`, so an expected `NULL` is a valid,
 * matchable value, not "skip this check"). If anything has claimed,
 * finalized, or otherwise transitioned the row since that snapshot, this
 * write's WHERE clause fails to match and it affects 0 rows — callers must
 * treat that as "someone else already handled this concurrently," not an
 * error, and must not act as though the reset landed. This also correctly
 * arbitrates concurrent recreators: if two callers snapshot the same
 * pre-recreation values and both attempt this write, Postgres's row lock
 * serializes them and only the first to commit succeeds — the second
 * re-evaluates its WHERE clause against the row the first just changed and
 * safely no-ops. A worker process that is still actually running an
 * attempt against the row it claimed under the *old*, now-disappeared job
 * (its Redis job entry can vanish — e.g. retention, manual intervention —
 * while its handler is still executing) is unaffected either way: its own
 * eventual finalize is independently guarded by `requireToken` against its
 * own captured token, which this reset does not change the safety of.
 */
export function resetForJobRecreationSql(params: RecreateJobResetParams): [string, unknown[]] {
  const sql = `UPDATE provider_events
     SET status = 'QUEUED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP,
         processing_token = NULL, processing_attempt = NULL
     WHERE tenant_id = $1::uuid AND id = $2::uuid
       AND status = ANY($3::"ProviderEventStatus"[])
       AND processing_token IS NOT DISTINCT FROM $4
       AND processing_attempt IS NOT DISTINCT FROM $5`;
  return [
    sql,
    [params.tenantId, params.eventRowId, params.allowedFrom, params.expectedToken, params.expectedAttempt],
  ];
}

/** Bumps updated_at without changing status — used by the recovery sweep
 * when a row was examined but no action was warranted (a job is already
 * legitimately in flight). Without this, the same oldest N rows would be
 * re-selected by the sweep's `ORDER BY updated_at ASC LIMIT` every tick
 * forever, starving every row past the batch limit from ever being looked
 * at. Guarded to RECEIVED/QUEUED so it never resurrects a row another actor
 * has since moved to a terminal (or parked) state. */
export function touchExaminedSql(tenantId: string, eventRowId: string): [string, unknown[]] {
  const sql = `UPDATE provider_events SET updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = ANY($3::"ProviderEventStatus"[])`;
  return [sql, [tenantId, eventRowId, ['RECEIVED', 'QUEUED'] satisfies ProviderEventStatus[]]];
}

export interface OwnershipRow {
  status: ProviderEventStatus;
  processingToken: string | null;
}

/**
 * The fencing read hydration services issue as the FIRST statement inside
 * the very transaction that applies their local effect (ADR-0031, second
 * correction): `SELECT ... FOR UPDATE` takes a real Postgres row lock on
 * the provider_events row for the lifetime of this transaction, so no
 * concurrent claim/finalize from another attempt can interleave between
 * this validation and the transaction's commit — unlike a plain read
 * (the original design's `ownsEvent()`, since removed), which only proved
 * ownership at the instant it ran, not for the rest of the attempt.
 * Callers must check the returned row's status/processingToken against
 * their own expected token before doing anything else; a mismatch (or a
 * missing row) means this attempt has lost ownership and must apply no
 * effect and write nothing.
 */
export function ownershipLockSql(tenantId: string, eventRowId: string): [string, unknown[]] {
  const sql = `SELECT status::text AS status, processing_token AS "processingToken"
     FROM provider_events
     WHERE tenant_id = $1::uuid AND id = $2::uuid
     FOR UPDATE`;
  return [sql, [tenantId, eventRowId]];
}

/** True only if the ownership row exists, is still QUEUED (the only status
 * a claimed-but-not-yet-finalized attempt can be in), and its token matches
 * this attempt's. Call after `ownershipLockSql` while still holding its
 * row lock. */
export function ownsRow(row: OwnershipRow | undefined, token: string): boolean {
  return row?.status === 'QUEUED' && row.processingToken === token;
}
