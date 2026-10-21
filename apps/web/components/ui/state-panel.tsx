import { CircleAlert, Inbox, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Skeleton } from './skeleton';

/** Shared empty, no-results, error and loading treatments (Milestone 24, S28). */

function PanelFrame({
  icon,
  title,
  description,
  children,
  tone = 'muted',
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center"
    >
      <span
        className={
          tone === 'danger'
            ? 'flex size-10 items-center justify-center rounded-full bg-destructive-surface text-destructive'
            : 'flex size-10 items-center justify-center rounded-full bg-secondary text-primary'
        }
      >
        {icon}
      </span>
      <div className="space-y-1">
        <p className="font-bold">{title}</p>
        {description ? (
          <p className="max-w-[28rem] text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Nothing exists yet (first use). */
export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <PanelFrame
      icon={<Inbox aria-hidden="true" className="size-5" />}
      title={title}
      description={description}
    >
      {action}
    </PanelFrame>
  );
}

/** Data exists but the current filters match nothing. */
export function NoResultsPanel({ onClear }: { onClear?: () => void }) {
  return (
    <PanelFrame
      icon={<SearchX aria-hidden="true" className="size-5" />}
      title="No results"
      description="Nothing matches the current search and filters. Your data is unchanged."
    >
      {onClear ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </PanelFrame>
  );
}

/** A load failed. Shows an optional request reference so support can find it. */
export function ErrorPanel({
  title = 'We could not load this',
  description = 'Nothing was changed. Try again; if it keeps failing, give the reference below to support.',
  reference,
  onRetry,
}: {
  title?: string;
  description?: string;
  reference?: string;
  onRetry?: () => void;
}) {
  return (
    <PanelFrame
      tone="danger"
      icon={<CircleAlert aria-hidden="true" className="size-5" />}
      title={title}
      description={description}
    >
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {reference ? <p className="text-xs text-muted-foreground">Reference: {reference}</p> : null}
    </PanelFrame>
  );
}

/** Skeleton rows that keep the layout steady while a list loads. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** A denied route is a visible shared state with a safe way back. */
export function SectionAccess({
  allowed,
  backHref,
  children,
}: {
  allowed: boolean;
  backHref: string;
  children?: ReactNode;
}) {
  return allowed ? (
    children
  ) : (
    <EmptyPanel
      title="You don't have access to this section"
      description="Choose a section available to your role."
      action={
        <Button asChild variant="outline">
          <a href={backHref}>Back to dashboard</a>
        </Button>
      }
    />
  );
}
