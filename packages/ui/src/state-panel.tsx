'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';

export type StatePanelVariant = 'empty' | 'error' | 'loading' | 'no-permission' | 'not-available';

type StatePanelContentProps = {
  /** Optional custom class names for layout-specific consumers. */
  className?: string;
  /** The state illustration or icon. It is decorative because the text names the state. */
  icon: ReactNode;
  /** The primary heading for the state. */
  title: ReactNode;
  /** Supporting copy that explains the state. */
  body: ReactNode;
};

export type StatePanelProps =
  | (StatePanelContentProps & {
      /** Empty states must always give the user a way forward. */
      action: ReactNode;
      variant: 'empty';
    })
  | (StatePanelContentProps & {
      action?: ReactNode;
      variant: Exclude<StatePanelVariant, 'empty'>;
    });

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

/** Shared presentation for empty, error, loading, permission, and unavailable states. */
export function StatePanel({ className, icon, title, body, action, variant }: StatePanelProps) {
  const titleId = useId();
  const bodyId = useId();
  const hasBody = body !== null && body !== undefined;
  const liveRegionProps =
    variant === 'error'
      ? { 'aria-live': 'assertive' as const, role: 'alert' as const }
      : variant === 'loading'
        ? { 'aria-busy': true, 'aria-live': 'polite' as const, role: 'status' as const }
        : {};

  return (
    <section
      aria-describedby={hasBody ? bodyId : undefined}
      aria-labelledby={titleId}
      className={classNames('must-state-panel', `must-state-panel--${variant}`, className)}
      {...liveRegionProps}
    >
      <span aria-hidden="true" className="must-state-panel__icon">
        {icon}
      </span>
      <h2 className="must-state-panel__title" id={titleId}>
        {title}
      </h2>
      {hasBody ? (
        <div className="must-state-panel__body" id={bodyId}>
          {body}
        </div>
      ) : null}
      {variant === 'loading' ? (
        <div aria-hidden="true" className="must-state-panel__loading-card">
          <div className="must-skeleton" />
          <div className="must-skeleton" />
          <div className="must-skeleton" />
        </div>
      ) : null}
      {action !== undefined && action !== null ? (
        <div className="must-state-panel__action">{action}</div>
      ) : null}
    </section>
  );
}
