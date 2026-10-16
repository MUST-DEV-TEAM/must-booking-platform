import type { LucideIcon } from 'lucide-react';

import { cn } from '../../lib/utils';

export type ActivityEntry = {
  key: string;
  title: string;
  detail?: string;
  /** ISO time of the event. */
  at: string;
  actor?: string | null;
  icon: LucideIcon;
  tone?: 'default' | 'success' | 'danger' | 'info';
};

const toneClass = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success-surface text-success',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info-surface text-info',
} as const;

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * What happened and when: grouped by day, newest first, an icon per event on a vertical line,
 * with the time and who did it. Entries are shown in the order given.
 */
export function ActivityFeed({
  entries,
  empty = 'Nothing has happened yet.',
}: {
  entries: readonly ActivityEntry[];
  empty?: string;
}) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const groups: Array<{ day: string; items: ActivityEntry[] }> = [];
  for (const entry of entries) {
    const day = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.day} className="space-y-2">
          <p className="m-0 text-xs font-semibold text-muted-foreground">{group.day}</p>
          <ol className="m-0 list-none p-0">
            {group.items.map((entry, index) => {
              const Icon = entry.icon;
              return (
                <li key={entry.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < group.items.length - 1 ? (
                    <span aria-hidden="true" className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border" />
                  ) : null}
                  <span
                    className={cn(
                      'relative flex size-8 shrink-0 items-center justify-center rounded-full',
                      toneClass[entry.tone ?? 'default'],
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5 pt-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="m-0 text-sm leading-5 font-semibold">{entry.title}</p>
                      <time dateTime={entry.at} className="m-0 shrink-0 text-xs leading-5 text-muted-foreground">
                        {timeLabel(entry.at)}
                      </time>
                    </div>
                    {entry.detail ? <p className="m-0 text-xs leading-4 text-muted-foreground">{entry.detail}</p> : null}
                    {entry.actor ? <p className="m-0 text-xs leading-4 text-muted-foreground">by {entry.actor}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
