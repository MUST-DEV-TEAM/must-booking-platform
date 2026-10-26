'use client';

import { RefreshCw } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';

export type SyncGroup = {
  key: string;
  label: string;
  hint: string;
  total: number | null;
  done: number;
  remaining: number | null;
  state: 'done' | 'running' | 'waiting' | 'error';
  ratePerMinute: number | null;
  etaSeconds: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  skipped: number;
  detail: string | null;
};

export type SyncSummary = {
  groups: SyncGroup[];
  overall: { percent: number; state: SyncGroup['state']; etaSeconds: number | null };
};

const number = (value: number) => value.toLocaleString('en-GB');

/** "about 5 h 20 min", "about 12 min", "under a minute". Estimates are never shown more exactly than that. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `about ${days} d ${restHours} h` : `about ${days} d`;
}

function formatRate(perMinute: number): string {
  return perMinute >= 1
    ? `${Math.round(perMinute)} per minute`
    : `${Math.round(perMinute * 60)} per hour`;
}

const STATE: Record<
  SyncGroup['state'],
  { label: string; variant: 'success' | 'info' | 'muted' | 'danger' }
> = {
  done: { label: 'Up to date', variant: 'success' },
  running: { label: 'Importing', variant: 'info' },
  waiting: { label: 'Waiting', variant: 'muted' },
  error: { label: 'Needs attention', variant: 'danger' },
};

function GroupRow({ group }: { group: SyncGroup }) {
  const percent =
    group.state === 'done'
      ? 100
      : group.total
        ? Math.min(100, Math.floor((group.done / group.total) * 100))
        : 0;
  const state = STATE[group.state];
  return (
    <li className="flex flex-col gap-1.5 py-3" data-sync-group={group.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{group.label}</span>
        <Badge variant={state.variant}>{state.label}</Badge>
      </div>
      <Progress value={percent} aria-label={`${group.label} progress`} />
      <p className="m-0 text-xs text-muted-foreground">
        {group.total === null
          ? 'Counting what Clock holds…'
          : group.state === 'done'
            ? `${number(group.total)} in total`
            : `${number(group.done)} of ${number(group.total)} · ${number(group.remaining ?? 0)} left`}
        {group.state === 'running' && group.ratePerMinute !== null
          ? ` · ${formatRate(group.ratePerMinute)}`
          : ''}
        {group.state === 'running' && group.etaSeconds !== null
          ? ` · ${formatDuration(group.etaSeconds)} left`
          : ''}
      </p>
      {group.detail ? <p className="m-0 text-xs font-medium">{group.detail}</p> : null}
      <p className="m-0 text-xs text-muted-foreground">{group.hint}</p>
      {group.skipped > 0 ? (
        <p className="m-0 text-xs text-warning">
          {number(group.skipped)} could not be brought in: their room type is not matched here or
          Clock gave them a status MUST does not know. The rest continues.
        </p>
      ) : null}
      {group.lastError ? (
        <p className="m-0 text-xs text-destructive" role="alert">
          {group.lastError}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What the hotel is bringing in from Clock: each part with how many items there are, how many are done,
 * how many are left, how fast it is going and about how long it will take.
 */
export function ClockSyncProgress({
  summary,
  enabled,
  onSyncNow,
  syncing,
  syncError,
}: {
  summary: SyncSummary;
  enabled: boolean;
  onSyncNow: () => void;
  syncing: boolean;
  syncError?: string | null;
}) {
  const { overall } = summary;
  return (
    <section aria-label="Clock synchronization progress" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            {overall.state === 'done' ? 'Everything is imported' : `Overall: ${overall.percent}%`}
          </span>
          <Button variant="outline" size="sm" disabled={syncing || !enabled} onClick={onSyncNow}>
            <RefreshCw aria-hidden="true" /> {syncing ? 'Asking Clock…' : 'Synchronize now'}
          </Button>
        </div>
        <Progress
          value={overall.state === 'done' ? 100 : overall.percent}
          aria-label="Overall synchronization progress"
        />
        <p className="m-0 text-xs text-muted-foreground">
          {!enabled
            ? 'Automatic synchronization is paused for this hotel.'
            : overall.state === 'done'
              ? 'Changes in Clock are picked up automatically every few minutes.'
              : overall.etaSeconds !== null
                ? `The full import will take ${formatDuration(overall.etaSeconds)} more. The site stays fully usable meanwhile.`
                : 'Estimating how long the import will take…'}
        </p>
        {syncError ? (
          <p className="m-0 text-xs text-destructive" role="alert">
            {syncError}
          </p>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col divide-y p-0">
        {summary.groups.map((group) => (
          <GroupRow key={group.key} group={group} />
        ))}
      </ul>
    </section>
  );
}
